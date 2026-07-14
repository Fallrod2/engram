import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { DEFAULT_DEV_USER_ID } from '../auth/config'
import { ValidationError } from '../http/errors'
import {
  deleteAiKey,
  getAiSettings,
  isAiConfigured,
  resolveActiveProvider,
  resolveOcrProvider,
  resolveProviderForTest,
  setAiKey,
  updateAiSettings,
} from './ai-config.service'

/**
 * AI config is now PER USER (spec BYOK §1.2). Every service function takes a
 * `userId`. Under the bun:test bypass (no auth env) the admin is
 * `DEFAULT_DEV_USER_ID` — so ADMIN gets the process-env fallback, while any OTHER
 * user (a public signup) does NOT: THE security fix. The demo account is a read
 * alias of the admin config.
 */

let t: TestDb
let db: DB

const ADMIN = DEFAULT_DEV_USER_ID
const OTHER = 'public-signup-user'

const ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'MISTRAL_API_KEY',
] as const
const SCOPE_VARS = ['ENGRAM_DEV_USER_ID', 'ENGRAM_ADMIN_USER_ID', 'ENGRAM_DEMO_USER_ID'] as const
const ALL_VARS = [...ENV_VARS, ...SCOPE_VARS] as const
const ORIGINAL = Object.fromEntries(ALL_VARS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  t = await createTestDb()
  db = t.db
  // Clear provider env AND scope env so ADMIN resolves deterministically to
  // DEFAULT_DEV_USER_ID (no leakage from a sibling spec's env mutation).
  for (const k of ALL_VARS) delete process.env[k]
})
afterEach(async () => {
  await t.cleanup()
})
afterAll(() => {
  for (const k of ALL_VARS) {
    const v = ORIGINAL[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('resolveActiveProvider — anthropic ordering (app > env > null) for the ADMIN', () => {
  it('null when neither an app key nor the env var is present', async () => {
    expect(await resolveActiveProvider(db, ADMIN)).toBeNull()
    expect(await isAiConfigured(db, ADMIN)).toBe(false)
  })

  it('env fallback: ANTHROPIC_API_KEY set → keySource env, secret undefined (SDK resolves)', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    const cfg = await resolveActiveProvider(db, ADMIN)
    expect(cfg).not.toBeNull()
    expect(cfg!.providerId).toBe('anthropic')
    expect(cfg!.keySource).toBe('env')
    expect(cfg!.secret).toBeUndefined()
    expect(cfg!.model).toBe('claude-sonnet-4-6')
  })

  it('app key wins over the env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    await setAiKey(db, ADMIN, 'anthropic', 'app-key')
    const cfg = await resolveActiveProvider(db, ADMIN)
    expect(cfg!.keySource).toBe('app')
    expect(cfg!.secret).toBe('app-key')
  })
})

describe('fallback env is ADMIN-ONLY (the security fix, spec BYOK §1.2)', () => {
  it('a public user does NOT consume the env key → unusable → null', async () => {
    process.env.ANTHROPIC_API_KEY = 'alex-env-key'
    // Admin resolves via the env fallback…
    expect((await resolveActiveProvider(db, ADMIN))!.keySource).toBe('env')
    // …but a public signup with no app key of their own gets nothing.
    expect(await resolveActiveProvider(db, OTHER)).toBeNull()
    expect(await isAiConfigured(db, OTHER)).toBe(false)
  })

  it('a public user becomes usable once they set THEIR OWN key (BYOK)', async () => {
    process.env.ANTHROPIC_API_KEY = 'alex-env-key'
    await setAiKey(db, OTHER, 'anthropic', 'other-own-key')
    const cfg = await resolveActiveProvider(db, OTHER)
    expect(cfg).not.toBeNull()
    expect(cfg!.keySource).toBe('app')
    expect(cfg!.secret).toBe('other-own-key')
  })

  it('the env badge never appears for a public user in the status surface', async () => {
    process.env.OPENROUTER_API_KEY = 'alex-or-env'
    const admin = await getAiSettings(db, ADMIN)
    expect(admin.statuses.find((s) => s.provider === 'openrouter')!.keySource).toBe('env')
    const other = await getAiSettings(db, OTHER)
    const or = other.statuses.find((s) => s.provider === 'openrouter')!
    expect(or.hasKey).toBe(false)
    expect(or.keySource).toBeNull()
  })
})

describe('per-user isolation of the config (2 users, 2 configs)', () => {
  it('each user has an independent active provider + keys', async () => {
    await updateAiSettings(db, ADMIN, { activeProvider: 'openrouter' })
    await setAiKey(db, ADMIN, 'openrouter', 'admin-or-key')
    await updateAiSettings(db, OTHER, { activeProvider: 'mistral' })
    await setAiKey(db, OTHER, 'mistral', 'other-mistral-key')

    const a = await getAiSettings(db, ADMIN)
    const o = await getAiSettings(db, OTHER)
    expect(a.settings.activeProvider).toBe('openrouter')
    expect(o.settings.activeProvider).toBe('mistral')
    // Neither sees the other's stored key as configured.
    expect(a.statuses.find((s) => s.provider === 'mistral')!.hasKey).toBe(false)
    expect(o.statuses.find((s) => s.provider === 'openrouter')!.hasKey).toBe(false)
    // And the resolved secrets are strictly each user's own.
    expect((await resolveActiveProvider(db, ADMIN))!.secret).toBe('admin-or-key')
    expect((await resolveActiveProvider(db, OTHER))!.secret).toBe('other-mistral-key')
  })
})

describe('demo account reads the ADMIN config (spec BYOK §1.2)', () => {
  const DEMO = 'demo-account-user'
  it('demo resolves generation/OCR via the admin, without its own key', async () => {
    process.env.ENGRAM_ADMIN_USER_ID = ADMIN
    process.env.ENGRAM_DEMO_USER_ID = DEMO
    await updateAiSettings(db, ADMIN, { activeProvider: 'openrouter' })
    await setAiKey(db, ADMIN, 'openrouter', 'admin-or-key')

    const cfg = await resolveActiveProvider(db, DEMO)
    expect(cfg).not.toBeNull()
    expect(cfg!.providerId).toBe('openrouter')
    expect(cfg!.secret).toBe('admin-or-key')
    // resolveProviderForTest is aliased too (POST test stays permitted for demo).
    const test = await resolveProviderForTest(db, DEMO, 'openrouter', {})
    expect(test!.secret).toBe('admin-or-key')
  })

  it('no recursion when demoUserId === adminUserId (amendment §4)', async () => {
    // The demo-reset bypass case: dev id == demo id. Must not loop forever.
    process.env.ENGRAM_DEV_USER_ID = DEMO
    process.env.ENGRAM_DEMO_USER_ID = DEMO
    await setAiKey(db, DEMO, 'anthropic', 'self-key')
    const cfg = await resolveActiveProvider(db, DEMO)
    expect(cfg!.secret).toBe('self-key')
  })
})

describe('resolveActiveProvider — other providers', () => {
  it('ollama is configured WITHOUT a key (default base URL + model) for ANY user', async () => {
    await updateAiSettings(db, OTHER, { activeProvider: 'ollama' })
    const cfg = await resolveActiveProvider(db, OTHER)
    expect(cfg).not.toBeNull()
    expect(cfg!.providerId).toBe('ollama')
    expect(cfg!.keySource).toBeNull()
    expect(cfg!.secret).toBeUndefined()
    expect(cfg!.baseUrl).toBe('http://localhost:11434')
  })

  it('openai-compat is NOT configured with an empty base URL', async () => {
    await updateAiSettings(db, ADMIN, {
      activeProvider: 'openai-compat',
      providers: { 'openai-compat': { model: 'local' } },
    })
    await setAiKey(db, ADMIN, 'openai-compat', 'k')
    // baseUrl still empty → unusable.
    expect(await resolveActiveProvider(db, ADMIN)).toBeNull()

    await updateAiSettings(db, ADMIN, {
      providers: { 'openai-compat': { baseUrl: 'http://localhost:1234/v1' } },
    })
    const cfg = await resolveActiveProvider(db, ADMIN)
    expect(cfg).not.toBeNull()
    expect(cfg!.baseUrl).toBe('http://localhost:1234/v1')
    expect(cfg!.secret).toBe('k')
  })
})

describe('updateAiSettings persistence', () => {
  it('switches the active provider and merges a partial model patch', async () => {
    await updateAiSettings(db, ADMIN, {
      activeProvider: 'openrouter',
      providers: { openrouter: { model: 'openai/gpt-4o-mini' } },
    })
    const { settings } = await getAiSettings(db, ADMIN)
    expect(settings.activeProvider).toBe('openrouter')
    expect(settings.providers.openrouter.model).toBe('openai/gpt-4o-mini')
    // Other providers keep their defaults.
    expect(settings.providers.anthropic.model).toBe('claude-sonnet-4-6')
  })

  it('rejects an invalid base URL (400)', async () => {
    await expect(
      updateAiSettings(db, ADMIN, { providers: { ollama: { baseUrl: 'not-a-url' } } }),
    ).rejects.toThrow()
  })
})

describe('write-only guarantee', () => {
  it('setAiKey stores the key but no read surface ever returns it', async () => {
    await setAiKey(db, ADMIN, 'openrouter', 'super-secret-value')
    const res = await getAiSettings(db, ADMIN)
    const openrouter = res.statuses.find((s) => s.provider === 'openrouter')!
    expect(openrouter.hasKey).toBe(true)
    expect(openrouter.keySource).toBe('app')
    // The full serialized response never contains the secret.
    expect(JSON.stringify(res)).not.toContain('super-secret-value')
    // No status object carries a `secret` field.
    for (const s of res.statuses) expect('secret' in s).toBe(false)
  })

  it('setAiKey rejects ollama (no key)', async () => {
    await expect(setAiKey(db, ADMIN, 'ollama', 'x')).rejects.toThrow(ValidationError)
  })
})

describe('resolveOcrProvider — mode same (default)', () => {
  it('follows the active generation provider when mode is "same"', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    // Default ocr mode is 'same' → OCR resolves exactly like generation.
    const gen = await resolveActiveProvider(db, ADMIN)
    const ocr = await resolveOcrProvider(db, ADMIN)
    expect(ocr).not.toBeNull()
    expect(ocr!.providerId).toBe('anthropic')
    expect(ocr!.model).toBe(gen!.model)
  })

  it('is null when the active provider is unusable (same as generation)', async () => {
    // No key anywhere → anthropic unusable → OCR unusable too.
    expect(await resolveOcrProvider(db, ADMIN)).toBeNull()
  })

  it('a public user gets no OCR from the env fallback either', async () => {
    process.env.ANTHROPIC_API_KEY = 'alex-env-key'
    expect(await resolveOcrProvider(db, OTHER)).toBeNull()
  })
})

describe('resolveOcrProvider — mode custom (the OCR/generation split)', () => {
  it('resolves a DISTINCT provider + model with its own key, independent of generation', async () => {
    // Generation = ollama (usable, key-less); OCR = mistral custom with its key.
    await updateAiSettings(db, ADMIN, { activeProvider: 'ollama' })
    await setAiKey(db, ADMIN, 'mistral', 'mistral-app-key')
    await updateAiSettings(db, ADMIN, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })

    const gen = await resolveActiveProvider(db, ADMIN)
    const ocr = await resolveOcrProvider(db, ADMIN)
    expect(gen!.providerId).toBe('ollama')
    expect(ocr).not.toBeNull()
    expect(ocr!.providerId).toBe('mistral')
    expect(ocr!.model).toBe('mistral-ocr-latest')
    expect(ocr!.secret).toBe('mistral-app-key')
    expect(ocr!.keySource).toBe('app')
  })

  it('is null when the custom OCR provider has no key, EVEN IF generation is usable', async () => {
    await updateAiSettings(db, ADMIN, { activeProvider: 'ollama' })
    await updateAiSettings(db, ADMIN, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    expect(await resolveActiveProvider(db, ADMIN)).not.toBeNull()
    expect(await resolveOcrProvider(db, ADMIN)).toBeNull()
  })

  it('falls back to MISTRAL_API_KEY from the env for the OCR slot (admin only)', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-env-key'
    await updateAiSettings(db, ADMIN, { activeProvider: 'ollama' })
    await updateAiSettings(db, ADMIN, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    const ocr = await resolveOcrProvider(db, ADMIN)
    expect(ocr).not.toBeNull()
    expect(ocr!.keySource).toBe('env')
    expect(ocr!.secret).toBe('mistral-env-key')
  })

  it('marks ocrActive on the effective OCR provider in the status surface', async () => {
    await updateAiSettings(db, ADMIN, { activeProvider: 'ollama' })
    await updateAiSettings(db, ADMIN, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    const { statuses } = await getAiSettings(db, ADMIN)
    const mistral = statuses.find((s) => s.provider === 'mistral')!
    const ollama = statuses.find((s) => s.provider === 'ollama')!
    expect(mistral.ocrActive).toBe(true)
    expect(mistral.active).toBe(false) // generation is ollama
    expect(ollama.active).toBe(true)
    expect(ollama.ocrActive).toBe(false)
  })
})

describe('updateAiSettings — OCR slot merge', () => {
  it('a PATCH touching a single OCR field leaves the others intact', async () => {
    await updateAiSettings(db, ADMIN, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    // Only change the model — provider + mode must survive.
    await updateAiSettings(db, ADMIN, { ocr: { model: 'mistral-ocr-2505' } })
    const { settings } = await getAiSettings(db, ADMIN)
    expect(settings.ocr.mode).toBe('custom')
    expect(settings.ocr.provider).toBe('mistral')
    expect(settings.ocr.model).toBe('mistral-ocr-2505')
  })

  it('a PATCH with no ocr key leaves the OCR slot untouched (no 400)', async () => {
    await updateAiSettings(db, ADMIN, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    await updateAiSettings(db, ADMIN, { activeProvider: 'openrouter' })
    const { settings } = await getAiSettings(db, ADMIN)
    expect(settings.ocr.mode).toBe('custom')
    expect(settings.ocr.provider).toBe('mistral')
  })
})

describe('deleteAiKey', () => {
  it('removes the app key; anthropic then falls back to the env var (admin)', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    await setAiKey(db, ADMIN, 'anthropic', 'app-key')
    expect((await resolveActiveProvider(db, ADMIN))!.keySource).toBe('app')

    await deleteAiKey(db, ADMIN, 'anthropic')
    const cfg = await resolveActiveProvider(db, ADMIN)
    expect(cfg!.keySource).toBe('env')
  })

  it('is scoped: deleting A’s key leaves B’s intact', async () => {
    await setAiKey(db, ADMIN, 'openrouter', 'admin-key')
    await setAiKey(db, OTHER, 'openrouter', 'other-key')
    await updateAiSettings(db, OTHER, { activeProvider: 'openrouter' })

    await deleteAiKey(db, ADMIN, 'openrouter')

    const admin = await getAiSettings(db, ADMIN)
    expect(admin.statuses.find((s) => s.provider === 'openrouter')!.hasKey).toBe(false)
    // B still has its own key.
    expect((await resolveActiveProvider(db, OTHER))!.secret).toBe('other-key')
  })

  it('is idempotent when no key exists', async () => {
    await expect(deleteAiKey(db, ADMIN, 'openrouter')).resolves.toBeUndefined()
  })
})
