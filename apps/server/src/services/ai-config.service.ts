import { eq } from 'drizzle-orm'
import {
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
import type { ResolvedProviderConfig } from '../ai/providers/types'

/** The single key under which the AI config blob lives in `app_settings`. */
const AI_KEY = 'ai'

export const PROVIDER_IDS: AiProviderId[] = ['anthropic', 'openrouter', 'ollama', 'openai-compat']

/** Optional env-var fallback per provider (retro-compat + convenience). */
const ENV_KEY_VAR: Partial<Record<AiProviderId, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'openai-compat': 'OPENAI_API_KEY',
}

/** Coded defaults, used when `app_settings['ai']` is absent. */
const DEFAULT_AI_SETTINGS: AiSettings = {
  activeProvider: 'anthropic',
  providers: {
    anthropic: { model: 'claude-sonnet-4-6' },
    openrouter: { model: 'anthropic/claude-3.5-sonnet' },
    ollama: { baseUrl: 'http://localhost:11434', model: 'llama3.1' },
    'openai-compat': { baseUrl: '', model: '' },
  },
}

// --- reading / writing the non-secret settings blob ------------------------

/** Robustly coerce a stored (possibly partial/legacy) blob into full settings. */
function coerceSettings(raw: unknown): AiSettings {
  const base: AiSettings = structuredClone(DEFAULT_AI_SETTINGS)
  if (!raw || typeof raw !== 'object') return base
  const r = raw as { activeProvider?: unknown; providers?: unknown }
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
  return base
}

async function readSettings(db: DB): Promise<AiSettings> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, AI_KEY))
  return coerceSettings(row?.value)
}

async function writeSettings(db: DB, settings: AiSettings): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: AI_KEY, value: settings })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: settings, updatedAt: new Date() },
    })
}

// --- secret access (internal only — the write-only boundary) ---------------

/** Read one stored app credential. INTERNAL ONLY (resolver + test endpoint). */
async function getCredentialSecret(db: DB, provider: AiProviderId): Promise<string | undefined> {
  const [row] = await db
    .select({ secret: aiCredential.secret })
    .from(aiCredential)
    .where(eq(aiCredential.provider, provider))
  return row?.secret
}

/** Providers that currently have an app credential row (NEVER reads the secret). */
async function keyedProviders(db: DB): Promise<Set<AiProviderId>> {
  const rows = await db.select({ provider: aiCredential.provider }).from(aiCredential)
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
 */
function resolveSecret(
  provider: AiProviderId,
  appSecret: string | undefined,
): { secret: string | undefined; keySource: 'app' | 'env' | null } {
  if (appSecret) return { secret: appSecret, keySource: 'app' }
  const env = envKey(provider)
  if (env) return { secret: provider === 'anthropic' ? undefined : env, keySource: 'env' }
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
export async function resolveActiveProvider(db: DB): Promise<ResolvedProviderConfig | null> {
  const settings = await readSettings(db)
  const provider = settings.activeProvider
  const pc = settings.providers[provider]
  const appSecret = provider === 'ollama' ? undefined : await getCredentialSecret(db, provider)
  const { secret, keySource } = resolveSecret(provider, appSecret)
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

export async function isAiConfigured(db: DB): Promise<boolean> {
  return (await resolveActiveProvider(db)) !== null
}

// --- status surface (write-only: never carries a secret) -------------------

async function providerStatuses(db: DB): Promise<AiProviderStatus[]> {
  const settings = await readSettings(db)
  const keyed = await keyedProviders(db)
  return PROVIDER_IDS.map((provider) => {
    const pc = settings.providers[provider]
    let hasKey = false
    let keySource: 'app' | 'env' | null = null
    if (provider !== 'ollama') {
      if (keyed.has(provider)) {
        hasKey = true
        keySource = 'app'
      } else if (envKey(provider)) {
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
    }
  })
}

export async function getAiSettings(db: DB): Promise<AiSettingsResponse> {
  const [settings, statuses] = await Promise.all([readSettings(db), providerStatuses(db)])
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
  input: UpdateAiSettings,
): Promise<AiSettingsResponse> {
  const current = await readSettings(db)
  const next: AiSettings = {
    activeProvider: input.activeProvider ?? current.activeProvider,
    providers: mergeProviders(current.providers, input.providers),
  }
  // Validate (URLs, shape) before persisting — a bad base URL is a 400.
  await writeSettings(db, aiSettingsSchema.parse(next))
  return getAiSettings(db)
}

// --- credential set / delete (write-only; routes return 204) ---------------

export async function setAiKey(db: DB, provider: AiProviderId, key: string): Promise<void> {
  if (provider === 'ollama') {
    throw new ValidationError('ollama does not use an API key')
  }
  await db
    .insert(aiCredential)
    .values({ provider, secret: key })
    .onConflictDoUpdate({
      target: aiCredential.provider,
      set: { secret: key, updatedAt: new Date() },
    })
}

export async function deleteAiKey(db: DB, provider: AiProviderId): Promise<void> {
  await db.delete(aiCredential).where(eq(aiCredential.provider, provider))
}

/**
 * Build a config for the TEST-CONNECTION endpoint: overlays an optional
 * not-yet-saved candidate (key / baseUrl / model) on the stored config. Reads
 * the stored secret ONLY here (internal). Returns null if the provider has no
 * usable model (nothing to test).
 */
export async function resolveProviderForTest(
  db: DB,
  provider: AiProviderId,
  candidate: {
    key?: string | undefined
    baseUrl?: string | undefined
    model?: string | undefined
  },
): Promise<ResolvedProviderConfig | null> {
  const settings = await readSettings(db)
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
      const appSecret = await getCredentialSecret(db, provider)
      const resolved = resolveSecret(provider, appSecret)
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
