import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '../db/test-db'
import type { DB } from '../db/client'
import { ValidationError } from '../http/errors'
import {
  deleteAiKey,
  getAiSettings,
  isAiConfigured,
  resolveActiveProvider,
  setAiKey,
  updateAiSettings,
} from './ai-config.service'

let t: TestDb
let db: DB

const ENV_VARS = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY'] as const
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
