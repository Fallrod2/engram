import { and, eq } from 'drizzle-orm'
import {
  aiOcrSettingsSchema,
  aiProviderConfigSchema,
  aiSettingsSchema,
  type AiProviderId,
  type AiProviderStatus,
  type AiSettings,
  type AiSettingsResponse,
  type UpdateAiSettings,
} from '@engram/shared'
import type { DB } from '../db/client'
import { appSettings, aiCredential } from '../db/schema'
import { ValidationError } from '../http/errors'
import { hasAnthropicKey } from '../ai/client'
import { resolveAuthConfig, resolveAdminUserId } from '../auth/config'
import type { ResolvedProviderConfig } from '../ai/providers/types'

/** The single key under which the AI config blob lives in `app_settings`. */
const AI_KEY = 'ai'

/**
 * Per-user scope context (spec BYOK §1.2). Two orthogonal decisions, resolved
 * ONCE at the entry of each resolver from the pure auth config:
 *
 * - `effectiveUserId` — the demo account is a READ ALIAS of the admin config: a
 *   controlled showcase reads Alex's config so generation/OCR work for it, while
 *   a public signup never can. This is a NON-recursive substitution (amendment
 *   §4): we swap the id and read the admin's rows directly — never re-enter a
 *   resolver with the admin id (the `demoUserId === adminUserId` bypass case
 *   would recurse forever).
 *
 * - `allowEnv` — THE security fix. The process env fallback (Alex's
 *   `ANTHROPIC_API_KEY` etc.) is consulted ONLY for the admin (or the demo, which
 *   resolves AS the admin). A public signup with no app key gets `keySource:null`
 *   → unusable → the existing clean 503, never Alex's key.
 */
function resolveScope(userId: string): { effectiveUserId: string; allowEnv: boolean } {
  const cfg = resolveAuthConfig(process.env)
  const adminUserId = resolveAdminUserId(cfg)
  const effectiveUserId =
    cfg.demoUserId && userId === cfg.demoUserId ? (adminUserId ?? userId) : userId
  const allowEnv = adminUserId !== undefined && effectiveUserId === adminUserId
  return { effectiveUserId, allowEnv }
}

/** Whether the env fallback is allowed for `userId` WITHOUT the demo alias (GET status). */
function envAllowedFor(userId: string): boolean {
  const adminUserId = resolveAdminUserId(resolveAuthConfig(process.env))
  return adminUserId !== undefined && userId === adminUserId
}

export const PROVIDER_IDS: AiProviderId[] = [
  'anthropic',
  'openrouter',
  'ollama',
  'openai-compat',
  'mistral',
]

/** Optional env-var fallback per provider (retro-compat + convenience). */
const ENV_KEY_VAR: Partial<Record<AiProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'openai-compat': 'OPENAI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
}

/** Coded defaults, used when `app_settings['ai']` is absent. */
const DEFAULT_AI_SETTINGS: AiSettings = {
  activeProvider: 'anthropic',
  providers: {
    anthropic: { model: 'claude-sonnet-4-6' },
    openrouter: { model: 'anthropic/claude-3.5-sonnet' },
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1' },
    'openai-compat': { baseUrl: '', model: '' },
    mistral: { model: 'mistral-small-latest' },
  },
  // `mode: 'same'` → OCR follows the active generation provider (historical
  // behaviour). Custom mode defaults to Mistral's dedicated OCR API.
  ocr: { mode: 'same', provider: 'mistral', model: 'mistral-ocr-latest' },
}

// --- reading / writing the non-secret settings blob ------------------------

/** Robustly coerce a stored (possibly partial/legacy) blob into full settings. */
function coerceSettings(raw: unknown): AiSettings {
  const base: AiSettings = structuredClone(DEFAULT_AI_SETTINGS)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as { activeProvider?: unknown; providers?: unknown; ocr?: unknown }
  if (
    typeof r.activeProvider === 'string' &&
    (PROVIDER_IDS as string[]).includes(r.activeProvider)
  ) {
    base.activeProvider = r.activeProvider as AiProviderId
  }
  if (r.providers && typeof r.providers === 'object') {
    const provs = r.providers as Record<string, unknown>
    for (const p of PROVIDER_IDS) {
      const parsed = aiProviderConfigSchema.safeParse(provs[p])
      if (parsed.success) base.providers[p] = parsed.data
    }
  }
  // The OCR slot is additive: a blob absent/partial/invalid falls back to the
  // default (mode 'same') — no store migration is ever needed.
  const ocr = aiOcrSettingsSchema.safeParse(r.ocr)
  if (ocr.success) base.ocr = ocr.data
  return base
}

async function readSettings(db: DB, userId: string): Promise<AiSettings> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(and(eq(appSettings.userId, userId), eq(appSettings.key, AI_KEY)))
  return coerceSettings(row?.value)
}

async function writeSettings(db: DB, userId: string, settings: AiSettings): Promise<void> {
  await db
    .insert(appSettings)
    .values({ userId, key: AI_KEY, value: settings })
    .onConflictDoUpdate({
      target: [appSettings.userId, appSettings.key],
      set: { value: settings, updatedAt: new Date() },
    })
}

// --- secret access (internal only — the write-only boundary) ---------------

/** Read one stored app credential. INTERNAL ONLY (resolver + test endpoint). */
async function getCredentialSecret(
  db: DB,
  userId: string,
  provider: AiProviderId,
): Promise<string | undefined> {
  const [row] = await db
    .select({ secret: aiCredential.secret })
    .from(aiCredential)
    .where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider)))
  return row?.secret
}

/** Providers that currently have an app credential row (NEVER reads the secret). */
async function keyedProviders(db: DB, userId: string): Promise<Set<AiProviderId>> {
  const rows = await db
    .select({ provider: aiCredential.provider })
    .from(aiCredential)
    .where(eq(aiCredential.userId, userId))
  return new Set(rows.map((r) => r.provider as AiProviderId))
}

// --- key/source resolution -------------------------------------------------

function envKey(provider: AiProviderId): string | undefined {
  const varName = ENV_KEY_VAR[provider]
  const v = varName ? process.env[varName]?.trim() : undefined
  return v && v.length > 0 ? v : undefined
}

/**
 * Resolve the secret + source for a provider. For anthropic in env mode we
 * return `secret=undefined` (the SDK reads `ANTHROPIC_API_KEY` itself); for the
 * fetch providers we return the actual env value so the adapter can send it.
 *
 * `allowEnv` is THE security gate (spec BYOK §1.2): the process-env fallback is
 * consulted ONLY for the admin (and the demo, which resolves as admin). A public
 * user with no app key gets `keySource:null` → unusable → clean 503, so a signup
 * can NEVER consume Alex's env key.
 */
function resolveSecret(
  provider: AiProviderId,
  appSecret: string | undefined,
  allowEnv: boolean,
): { secret: string | undefined; keySource: 'app' | 'env' | null } {
  if (appSecret) return { secret: appSecret, keySource: 'app' }
  if (!allowEnv) return { secret: undefined, keySource: null }
  if (provider === 'anthropic') {
    // The SDK reads ANTHROPIC_API_KEY (and machine profiles) itself, so we only
    // detect presence here via the shared `hasAnthropicKey()` fallback helper.
    return hasAnthropicKey()
      ? { secret: undefined, keySource: 'env' }
      : { secret: undefined, keySource: null }
  }
  const env = envKey(provider)
  if (env) return { secret: env, keySource: 'env' }
  return { secret: undefined, keySource: null }
}

function isUsable(
  provider: AiProviderId,
  model: string,
  hasKey: boolean,
  baseUrl: string | undefined,
): boolean {
  if (model.trim().length === 0) return false
  const hasBase = (baseUrl ?? '').trim().length > 0
  switch (provider) {
    case 'anthropic':
    case 'openrouter':
    case 'mistral':
      return hasKey
    case 'ollama':
      return hasBase
    case 'openai-compat':
      return hasKey && hasBase
  }
}

/**
 * Resolve the ACTIVE provider into a full config (secret included), or `null`
 * if it is not usable (→ the 503 in `/api/generations`). ONE DB read path.
 */
export async function resolveActiveProvider(
  db: DB,
  userId: string,
): Promise<ResolvedProviderConfig | null> {
  const { effectiveUserId, allowEnv } = resolveScope(userId)
  const settings = await readSettings(db, effectiveUserId)
  const provider = settings.activeProvider
  const pc = settings.providers[provider]
  const appSecret =
    provider === 'ollama' ? undefined : await getCredentialSecret(db, effectiveUserId, provider)
  const { secret, keySource } = resolveSecret(provider, appSecret, allowEnv)
  const model = pc.model.trim()
  const baseUrl = pc.baseUrl?.trim() || undefined

  if (!isUsable(provider, model, keySource !== null, baseUrl)) return null

  return {
    providerId: provider,
    model,
    keySource,
    ...(baseUrl ? { baseUrl } : {}),
    ...(secret !== undefined ? { secret } : {}),
  }
}

export async function isAiConfigured(db: DB, userId: string): Promise<boolean> {
  return (await resolveActiveProvider(db, userId)) !== null
}

/** The provider id effectively used by the OCR slot (spec §1.1). */
function ocrProviderId(settings: AiSettings): AiProviderId {
  return settings.ocr.mode === 'same' ? settings.activeProvider : settings.ocr.provider
}

/**
 * Resolve the OCR provider into a full config, or `null` if it is not usable
 * (→ the 503 in `/api/notes/extract-image`). In `mode: 'same'` this is exactly
 * `resolveActiveProvider` (OCR follows generation); in `mode: 'custom'` it uses
 * the dedicated `(ocr.provider, ocr.model)` couple with THAT provider's stored
 * key + base URL. This is what makes the OCR provider independent of generation.
 */
export async function resolveOcrProvider(
  db: DB,
  userId: string,
): Promise<ResolvedProviderConfig | null> {
  const { effectiveUserId, allowEnv } = resolveScope(userId)
  const settings = await readSettings(db, effectiveUserId)
  if (settings.ocr.mode === 'same') return resolveActiveProvider(db, userId)

  const provider = settings.ocr.provider
  const pc = settings.providers[provider]
  const appSecret =
    provider === 'ollama' ? undefined : await getCredentialSecret(db, effectiveUserId, provider)
  const { secret, keySource } = resolveSecret(provider, appSecret, allowEnv)
  const model = settings.ocr.model.trim()
  const baseUrl = pc.baseUrl?.trim() || undefined

  if (!isUsable(provider, model, keySource !== null, baseUrl)) return null

  return {
    providerId: provider,
    model,
    keySource,
    ...(baseUrl ? { baseUrl } : {}),
    ...(secret !== undefined ? { secret } : {}),
  }
}

// --- status surface (write-only: never carries a secret) -------------------

async function providerStatuses(db: DB, userId: string): Promise<AiProviderStatus[]> {
  // GET status is NOT demo-aliased (amendment §5): a user sees THEIR OWN config.
  // The env badge ("configuré (env)") therefore only ever appears for the admin.
  const allowEnv = envAllowedFor(userId)
  const settings = await readSettings(db, userId)
  const keyed = await keyedProviders(db, userId)
  const ocrProvider = ocrProviderId(settings)
  return PROVIDER_IDS.map((provider) => {
    const pc = settings.providers[provider]
    let hasKey = false
    let keySource: 'app' | 'env' | null = null
    if (provider !== 'ollama') {
      if (keyed.has(provider)) {
        hasKey = true
        keySource = 'app'
      } else if (allowEnv && envKey(provider)) {
        hasKey = true
        keySource = 'env'
      }
    }
    return {
      provider,
      requiresKey: provider !== 'ollama',
      hasKey,
      keySource,
      model: pc.model.length > 0 ? pc.model : null,
      ...(pc.baseUrl !== undefined ? { baseUrl: pc.baseUrl } : {}),
      active: settings.activeProvider === provider,
      ocrActive: ocrProvider === provider,
    }
  })
}

export async function getAiSettings(db: DB, userId: string): Promise<AiSettingsResponse> {
  const [settings, statuses] = await Promise.all([
    readSettings(db, userId),
    providerStatuses(db, userId),
  ])
  return { settings, statuses }
}

/** Merge a partial provider patch over the current full config. */
function mergeProviders(
  current: AiSettings['providers'],
  patch: UpdateAiSettings['providers'],
): AiSettings['providers'] {
  const out = structuredClone(current)
  if (!patch) return out
  for (const p of PROVIDER_IDS) {
    const u = patch[p]
    if (!u) continue
    const merged = { ...out[p] }
    if (u.model !== undefined) merged.model = u.model
    if (u.baseUrl !== undefined) merged.baseUrl = u.baseUrl
    out[p] = merged
  }
  return out
}

export async function updateAiSettings(
  db: DB,
  userId: string,
  input: UpdateAiSettings,
): Promise<AiSettingsResponse> {
  const current = await readSettings(db, userId)
  const next: AiSettings = {
    activeProvider: input.activeProvider ?? current.activeProvider,
    providers: mergeProviders(current.providers, input.providers),
    // Deep-merge the OCR slot so a PATCH that omits `ocr` leaves it untouched
    // (and one touching a single OCR field keeps the others).
    ocr: {
      mode: input.ocr?.mode ?? current.ocr.mode,
      provider: input.ocr?.provider ?? current.ocr.provider,
      model: input.ocr?.model ?? current.ocr.model,
    },
  }
  // Validate (URLs, shape) before persisting — a bad base URL is a 400.
  await writeSettings(db, userId, aiSettingsSchema.parse(next))
  return getAiSettings(db, userId)
}

// --- credential set / delete (write-only; routes return 204) ---------------

export async function setAiKey(
  db: DB,
  userId: string,
  provider: AiProviderId,
  key: string,
): Promise<void> {
  if (provider === 'ollama') {
    throw new ValidationError('ollama does not use an API key')
  }
  await db
    .insert(aiCredential)
    .values({ userId, provider, secret: key })
    .onConflictDoUpdate({
      target: [aiCredential.userId, aiCredential.provider],
      set: { secret: key, updatedAt: new Date() },
    })
}

export async function deleteAiKey(db: DB, userId: string, provider: AiProviderId): Promise<void> {
  await db
    .delete(aiCredential)
    .where(and(eq(aiCredential.userId, userId), eq(aiCredential.provider, provider)))
}

/**
 * Build a config for the TEST-CONNECTION endpoint: overlays an optional
 * not-yet-saved candidate (key / baseUrl / model) on the stored config. Reads
 * the stored secret ONLY here (internal). Returns null if the provider has no
 * usable model (nothing to test).
 */
export async function resolveProviderForTest(
  db: DB,
  userId: string,
  provider: AiProviderId,
  candidate: {
    key?: string | undefined
    baseUrl?: string | undefined
    model?: string | undefined
  },
): Promise<ResolvedProviderConfig | null> {
  const { effectiveUserId, allowEnv } = resolveScope(userId)
  const settings = await readSettings(db, effectiveUserId)
  const pc = settings.providers[provider]
  const model = (candidate.model ?? pc.model).trim()
  if (model.length === 0) return null
  const baseUrl = (candidate.baseUrl ?? pc.baseUrl ?? '').trim() || undefined

  let secret: string | undefined
  let keySource: 'app' | 'env' | null = null
  if (provider !== 'ollama') {
    if (candidate.key && candidate.key.trim().length > 0) {
      secret = candidate.key.trim()
      keySource = 'app'
    } else {
      const appSecret = await getCredentialSecret(db, effectiveUserId, provider)
      const resolved = resolveSecret(provider, appSecret, allowEnv)
      secret = resolved.secret
      keySource = resolved.keySource
    }
  }

  return {
    providerId: provider,
    model,
    keySource,
    ...(baseUrl ? { baseUrl } : {}),
    ...(secret !== undefined ? { secret } : {}),
  }
}
