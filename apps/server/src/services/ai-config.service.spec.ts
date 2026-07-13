import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { ValidationError } from '../http/errors'
import {
  deleteAiKey,
  getAiSettings,
  isAiConfigured,
  resolveActiveProvider,
  resolveOcrProvider,
  setAiKey,
  updateAiSettings,
} from './ai-config.service'

let t: TestDb
let db: DB

const ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'MISTRAL_API_KEY',
] as const
const ORIGINAL = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  t = await createTestDb()
  db = t.db
  for (const k of ENV_VARS) delete process.env[k]
})
afterEach(async () => {
  await t.cleanup()
})
afterAll(() => {
  for (const k of ENV_VARS) {
    const v = ORIGINAL[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('resolveActiveProvider — anthropic ordering (app > env > null)', () => {
  it('null when neither an app key nor the env var is present', async () => {
    expect(await resolveActiveProvider(db)).toBeNull()
    expect(await isAiConfigured(db)).toBe(false)
  })

  it('env fallback: ANTHROPIC_API_KEY set → keySource env, secret undefined (SDK resolves)', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    const cfg = await resolveActiveProvider(db)
    expect(cfg).not.toBeNull()
    expect(cfg!.providerId).toBe('anthropic')
    expect(cfg!.keySource).toBe('env')
    expect(cfg!.secret).toBeUndefined()
    expect(cfg!.model).toBe('claude-sonnet-4-6')
  })

  it('app key wins over the env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    await setAiKey(db, 'anthropic', 'app-key')
    const cfg = await resolveActiveProvider(db)
    expect(cfg!.keySource).toBe('app')
    expect(cfg!.secret).toBe('app-key')
  })
})

describe('resolveActiveProvider — other providers', () => {
  it('ollama is configured WITHOUT a key (default base URL + model)', async () => {
    await updateAiSettings(db, { activeProvider: 'ollama' })
    const cfg = await resolveActiveProvider(db)
    expect(cfg).not.toBeNull()
    expect(cfg!.providerId).toBe('ollama')
    expect(cfg!.keySource).toBeNull()
    expect(cfg!.secret).toBeUndefined()
    expect(cfg!.baseUrl).toBe('http://localhost:11434')
  })

  it('openai-compat is NOT configured with an empty base URL', async () => {
    await updateAiSettings(db, {
      activeProvider: 'openai-compat',
      providers: { 'openai-compat': { model: 'local' } },
    })
    await setAiKey(db, 'openai-compat', 'k')
    // baseUrl still empty → unusable.
    expect(await resolveActiveProvider(db)).toBeNull()

    await updateAiSettings(db, {
      providers: { 'openai-compat': { baseUrl: 'http://localhost:1234/v1' } },
    })
    const cfg = await resolveActiveProvider(db)
    expect(cfg).not.toBeNull()
    expect(cfg!.baseUrl).toBe('http://localhost:1234/v1')
    expect(cfg!.secret).toBe('k')
  })
})

describe('updateAiSettings persistence', () => {
  it('switches the active provider and merges a partial model patch', async () => {
    await updateAiSettings(db, {
      activeProvider: 'openrouter',
      providers: { openrouter: { model: 'openai/gpt-4o-mini' } },
    })
    const { settings } = await getAiSettings(db)
    expect(settings.activeProvider).toBe('openrouter')
    expect(settings.providers.openrouter.model).toBe('openai/gpt-4o-mini')
    // Other providers keep their defaults.
    expect(settings.providers.anthropic.model).toBe('claude-sonnet-4-6')
  })

  it('rejects an invalid base URL (400)', async () => {
    await expect(
      updateAiSettings(db, { providers: { ollama: { baseUrl: 'not-a-url' } } }),
    ).rejects.toThrow()
  })
})

describe('write-only guarantee', () => {
  it('setAiKey stores the key but no read surface ever returns it', async () => {
    await setAiKey(db, 'openrouter', 'super-secret-value')
    const res = await getAiSettings(db)
    const openrouter = res.statuses.find((s) => s.provider === 'openrouter')!
    expect(openrouter.hasKey).toBe(true)
    expect(openrouter.keySource).toBe('app')
    // The full serialized response never contains the secret.
    expect(JSON.stringify(res)).not.toContain('super-secret-value')
    // No status object carries a `secret` field.
    for (const s of res.statuses) expect('secret' in s).toBe(false)
  })

  it('setAiKey rejects ollama (no key)', async () => {
    await expect(setAiKey(db, 'ollama', 'x')).rejects.toThrow(ValidationError)
  })
})

describe('resolveOcrProvider — mode same (default)', () => {
  it('follows the active generation provider when mode is "same"', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    // Default ocr mode is 'same' → OCR resolves exactly like generation.
    const gen = await resolveActiveProvider(db)
    const ocr = await resolveOcrProvider(db)
    expect(ocr).not.toBeNull()
    expect(ocr!.providerId).toBe('anthropic')
    expect(ocr!.model).toBe(gen!.model)
  })

  it('is null when the active provider is unusable (same as generation)', async () => {
    // No key anywhere → anthropic unusable → OCR unusable too.
    expect(await resolveOcrProvider(db)).toBeNull()
  })
})

describe('resolveOcrProvider — mode custom (the OCR/generation split)', () => {
  it('resolves a DISTINCT provider + model with its own key, independent of generation', async () => {
    // Generation = ollama (usable, key-less); OCR = mistral custom with its key.
    await updateAiSettings(db, { activeProvider: 'ollama' })
    await setAiKey(db, 'mistral', 'mistral-app-key')
    await updateAiSettings(db, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })

    const gen = await resolveActiveProvider(db)
    const ocr = await resolveOcrProvider(db)
    expect(gen!.providerId).toBe('ollama')
    expect(ocr).not.toBeNull()
    expect(ocr!.providerId).toBe('mistral')
    expect(ocr!.model).toBe('mistral-ocr-latest')
    expect(ocr!.secret).toBe('mistral-app-key')
    expect(ocr!.keySource).toBe('app')
  })

  it('is null when the custom OCR provider has no key, EVEN IF generation is usable', async () => {
    // Generation stays usable (ollama), but the OCR slot points at an unkeyed
    // mistral → the split is proven: OCR fails independently.
    await updateAiSettings(db, { activeProvider: 'ollama' })
    await updateAiSettings(db, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    expect(await resolveActiveProvider(db)).not.toBeNull()
    expect(await resolveOcrProvider(db)).toBeNull()
  })

  it('falls back to MISTRAL_API_KEY from the env for the OCR slot', async () => {
    process.env.MISTRAL_API_KEY = 'mistral-env-key'
    await updateAiSettings(db, { activeProvider: 'ollama' })
    await updateAiSettings(db, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    const ocr = await resolveOcrProvider(db)
    expect(ocr).not.toBeNull()
    expect(ocr!.keySource).toBe('env')
    expect(ocr!.secret).toBe('mistral-env-key')
  })

  it('marks ocrActive on the effective OCR provider in the status surface', async () => {
    await updateAiSettings(db, { activeProvider: 'ollama' })
    await updateAiSettings(db, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    const { statuses } = await getAiSettings(db)
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
    await updateAiSettings(db, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    // Only change the model — provider + mode must survive.
    await updateAiSettings(db, { ocr: { model: 'mistral-ocr-2505' } })
    const { settings } = await getAiSettings(db)
    expect(settings.ocr.mode).toBe('custom')
    expect(settings.ocr.provider).toBe('mistral')
    expect(settings.ocr.model).toBe('mistral-ocr-2505')
  })

  it('a PATCH with no ocr key leaves the OCR slot untouched (no 400)', async () => {
    await updateAiSettings(db, {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    await updateAiSettings(db, { activeProvider: 'openrouter' })
    const { settings } = await getAiSettings(db)
    expect(settings.ocr.mode).toBe('custom')
    expect(settings.ocr.provider).toBe('mistral')
  })
})

describe('deleteAiKey', () => {
  it('removes the app key; anthropic then falls back to the env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key'
    await setAiKey(db, 'anthropic', 'app-key')
    expect((await resolveActiveProvider(db))!.keySource).toBe('app')

    await deleteAiKey(db, 'anthropic')
    const cfg = await resolveActiveProvider(db)
    expect(cfg!.keySource).toBe('env')
  })

  it('is idempotent when no key exists', async () => {
    await expect(deleteAiKey(db, 'openrouter')).resolves.toBeUndefined()
  })
})
