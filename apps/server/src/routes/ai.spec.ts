import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SignJWT } from 'jose'
import {
  aiSettingsResponseSchema,
  listModelsResponseSchema,
  testConnectionResponseSchema,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb } from '../test-support/harness'

const ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'MISTRAL_API_KEY',
] as const
const ORIGINAL_ENV = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]))
const ORIGINAL_FETCH = globalThis.fetch

beforeEach(async () => {
  await resetDb(db)
  for (const k of ENV_VARS) delete process.env[k]
})
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})
afterAll(() => {
  for (const k of ENV_VARS) {
    const v = ORIGINAL_ENV[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  globalThis.fetch = ORIGINAL_FETCH
})

const json = (path: string, method: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

/** Install a fetch stub that routes the response by URL substring. */
function mockFetch(routes: (url: string) => Response) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString()
    return routes(u)
  }) as unknown as typeof fetch
}
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('GET /api/ai/settings', () => {
  it('returns config + statuses and never a secret', async () => {
    const r = await app.request('/api/ai/settings')
    expect(r.status).toBe(200)
    const parsed = aiSettingsResponseSchema.parse(await r.json())
    expect(parsed.settings.activeProvider).toBe('anthropic')
    expect(parsed.statuses).toHaveLength(5)
    const ollama = parsed.statuses.find((s) => s.provider === 'ollama')!
    expect(ollama.requiresKey).toBe(false)
    // Mistral is now a first-class provider (requires a key like anthropic).
    const mistral = parsed.statuses.find((s) => s.provider === 'mistral')!
    expect(mistral.requiresKey).toBe(true)
    // Default OCR mode is 'same' → the OCR slot follows the active provider.
    expect(parsed.settings.ocr.mode).toBe('same')
    const anthropic = parsed.statuses.find((s) => s.provider === 'anthropic')!
    expect(anthropic.ocrActive).toBe(true)
    expect(mistral.ocrActive).toBe(false)
    // No status object carries a `secret`.
    for (const s of parsed.statuses) expect('secret' in s).toBe(false)
  })

  it('reflects the OCR/generation split: a custom OCR provider is ocrActive but not active', async () => {
    await json('/api/ai/settings', 'PATCH', { activeProvider: 'ollama' })
    await json('/api/ai/settings', 'PATCH', {
      ocr: { mode: 'custom', provider: 'mistral', model: 'mistral-ocr-latest' },
    })
    const parsed = aiSettingsResponseSchema.parse(
      await (await app.request('/api/ai/settings')).json(),
    )
    expect(parsed.settings.ocr.provider).toBe('mistral')
    const mistral = parsed.statuses.find((s) => s.provider === 'mistral')!
    expect(mistral.ocrActive).toBe(true)
    expect(mistral.active).toBe(false)
  })
})

describe('POST /api/ai/providers/mistral/test', () => {
  it('validates the key via GET /v1/models without calling /v1/ocr', async () => {
    let ocrCalled = false
    mockFetch((url) => {
      if (url.endsWith('/ocr')) ocrCalled = true
      return res({ data: [{ id: 'mistral-ocr-latest' }] })
    })
    const r = await json('/api/ai/providers/mistral/test', 'POST', {
      key: 'mist-candidate',
      model: 'mistral-ocr-latest',
    })
    expect(r.status).toBe(200)
    const parsed = testConnectionResponseSchema.parse(await r.json())
    expect(parsed.ok).toBe(true)
    expect(ocrCalled).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain('mist-candidate')
  })
})

describe('PATCH /api/ai/settings', () => {
  it('switches the active provider', async () => {
    const r = await json('/api/ai/settings', 'PATCH', { activeProvider: 'ollama' })
    expect(r.status).toBe(200)
    const parsed = aiSettingsResponseSchema.parse(await r.json())
    expect(parsed.settings.activeProvider).toBe('ollama')
  })

  it('rejects an invalid base URL (400)', async () => {
    const r = await json('/api/ai/settings', 'PATCH', {
      providers: { ollama: { baseUrl: 'not-a-url' } },
    })
    expect(r.status).toBe(400)
  })
})

describe('PUT / DELETE key (write-only, 204)', () => {
  it('PUT stores the key → 204; GET reflects status but never the secret', async () => {
    const put = await json('/api/ai/providers/openrouter/key', 'PUT', { key: 'or-live-secret' })
    expect(put.status).toBe(204)

    const r = await app.request('/api/ai/settings')
    const bodyText = await r.text()
    expect(bodyText).not.toContain('or-live-secret')
    const parsed = aiSettingsResponseSchema.parse(JSON.parse(bodyText))
    const openrouter = parsed.statuses.find((s) => s.provider === 'openrouter')!
    expect(openrouter.hasKey).toBe(true)
    expect(openrouter.keySource).toBe('app')
  })

  it('DELETE removes the key → 204', async () => {
    await json('/api/ai/providers/openrouter/key', 'PUT', { key: 'x' })
    const del = await app.request('/api/ai/providers/openrouter/key', { method: 'DELETE' })
    expect(del.status).toBe(204)
    const parsed = aiSettingsResponseSchema.parse(
      await (await app.request('/api/ai/settings')).json(),
    )
    expect(parsed.statuses.find((s) => s.provider === 'openrouter')!.hasKey).toBe(false)
  })

  it('PUT a key for ollama → 400 (no key provider)', async () => {
    const r = await json('/api/ai/providers/ollama/key', 'PUT', { key: 'x' })
    expect(r.status).toBe(400)
  })
})

describe('POST /api/ai/providers/:provider/test', () => {
  it('ollama reachable → ok, with installed models', async () => {
    mockFetch(() => res({ models: [{ name: 'llama3.1', details: { parameter_size: '8B' } }] }))
    const r = await json('/api/ai/providers/ollama/test', 'POST', {})
    expect(r.status).toBe(200)
    const parsed = testConnectionResponseSchema.parse(await r.json())
    expect(parsed.ok).toBe(true)
    expect(parsed.models).toEqual([{ id: 'llama3.1', label: 'llama3.1 · 8B' }])
  })

  it('openrouter with a rejected candidate key → ok:false (no leak)', async () => {
    mockFetch(() => res({}, 401))
    const r = await json('/api/ai/providers/openrouter/test', 'POST', { key: 'bad-key' })
    expect(r.status).toBe(200)
    const parsed = testConnectionResponseSchema.parse(await r.json())
    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain('bad-key')
  })
})

describe('GET /api/ai/providers/:provider/models', () => {
  it('lists ollama models (mocked)', async () => {
    mockFetch(() => res({ models: [{ name: 'qwen2.5' }] }))
    const r = await app.request('/api/ai/providers/ollama/models')
    expect(r.status).toBe(200)
    const parsed = listModelsResponseSchema.parse(await r.json())
    expect(parsed.models).toEqual([{ id: 'qwen2.5' }])
  })

  it('anthropic (no listModels) → empty list', async () => {
    const r = await app.request('/api/ai/providers/anthropic/models')
    const parsed = listModelsResponseSchema.parse(await r.json())
    expect(parsed.models).toEqual([])
  })
})

describe('per-user config isolation over the API (spec BYOK §1.3)', () => {
  const SECRET = 'a-shared-secret-at-least-32-bytes-long!!'

  async function bearer(sub: string): Promise<Record<string, string>> {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET))
    return { Authorization: `Bearer ${token}` }
  }

  const jsonAs = (h: Record<string, string>, path: string, method: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...h },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

  it('two users have strictly separate config + keys', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    try {
      const alice = await bearer('alice-uuid')
      const bob = await bearer('bob-uuid')

      // Alice sets openrouter + a key; Bob sets mistral.
      await jsonAs(alice, '/api/ai/settings', 'PATCH', { activeProvider: 'openrouter' })
      const put = await jsonAs(alice, '/api/ai/providers/openrouter/key', 'PUT', {
        key: 'alice-or-secret',
      })
      expect(put.status).toBe(204)
      await jsonAs(bob, '/api/ai/settings', 'PATCH', { activeProvider: 'mistral' })

      // Each sees only their own active provider…
      const aSettings = aiSettingsResponseSchema.parse(
        await (await jsonAs(alice, '/api/ai/settings', 'GET')).json(),
      )
      const bSettings = aiSettingsResponseSchema.parse(
        await (await jsonAs(bob, '/api/ai/settings', 'GET')).json(),
      )
      expect(aSettings.settings.activeProvider).toBe('openrouter')
      expect(bSettings.settings.activeProvider).toBe('mistral')

      // …and Bob never sees Alice's key as configured (nor the secret anywhere).
      expect(aSettings.statuses.find((s) => s.provider === 'openrouter')!.hasKey).toBe(true)
      expect(bSettings.statuses.find((s) => s.provider === 'openrouter')!.hasKey).toBe(false)
      expect(JSON.stringify(bSettings)).not.toContain('alice-or-secret')
    } finally {
      delete process.env.SUPABASE_JWT_SECRET
    }
  })
})
