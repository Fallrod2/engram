import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import {
  aiSettingsResponseSchema,
  codexLinkPollResponseSchema,
  codexLinkStartResponseSchema,
} from '@engram/shared'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb } from '../test-support/harness'

/**
 * openai-codex device-code LINK routes (spec §4.2), fully mocked — NO network,
 * NO real account. `globalThis.fetch` is stubbed to imitate the OpenAI endpoints;
 * the kill-switch is toggled via `ENGRAM_ENABLE_CODEX`.
 */

const ORIGINAL_FETCH = globalThis.fetch

beforeEach(async () => {
  await resetDb(db)
  process.env.ENGRAM_ENABLE_CODEX = '1'
})
afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.ENGRAM_ENABLE_CODEX
})

const json = (path: string, method: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Route the mocked OpenAI endpoints by URL substring. */
function mockOpenAi(opts: { pollPending?: boolean } = {}) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = typeof url === 'string' ? url : url.toString()
    if (u.includes('/deviceauth/usercode')) {
      return res({ device_auth_id: 'dev-1', user_code: 'ABCD-1234', interval: '5' })
    }
    if (u.includes('/deviceauth/token')) {
      if (opts.pollPending) return new Response('', { status: 403 })
      return res({ authorization_code: 'auth-code', code_verifier: 'verifier' })
    }
    if (u.includes('/oauth/token')) {
      return res({
        id_token: fakeJwt({ chatgpt_account_id: 'acct-xyz' }),
        access_token: fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
        refresh_token: 'refresh-1',
      })
    }
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
}

describe('POST /providers/openai-codex/link/start', () => {
  it('returns a user code + verification URI + opaque handle', async () => {
    mockOpenAi()
    const r = await json('/api/ai/providers/openai-codex/link/start', 'POST', {})
    expect(r.status).toBe(200)
    const parsed = codexLinkStartResponseSchema.parse(await r.json())
    expect(parsed.userCode).toBe('ABCD-1234')
    expect(parsed.verificationUri).toContain('device')
    expect(parsed.expiresIn).toBe(900)
    expect(parsed.handle.length).toBeGreaterThan(10)
  })

  it('503 when the kill-switch is OFF', async () => {
    delete process.env.ENGRAM_ENABLE_CODEX
    mockOpenAi()
    const r = await json('/api/ai/providers/openai-codex/link/start', 'POST', {})
    expect(r.status).toBe(503)
  })
})

describe('POST /providers/openai-codex/link/poll', () => {
  it('pending while the user has not authorized yet', async () => {
    mockOpenAi({ pollPending: true })
    const start = codexLinkStartResponseSchema.parse(
      await (await json('/api/ai/providers/openai-codex/link/start', 'POST', {})).json(),
    )
    const r = await json('/api/ai/providers/openai-codex/link/poll', 'POST', {
      handle: start.handle,
    })
    const parsed = codexLinkPollResponseSchema.parse(await r.json())
    expect(parsed.status).toBe('pending')
  })

  it('links on success, persists tokens, and never returns a token', async () => {
    mockOpenAi()
    const start = codexLinkStartResponseSchema.parse(
      await (await json('/api/ai/providers/openai-codex/link/start', 'POST', {})).json(),
    )
    const pollRes = await json('/api/ai/providers/openai-codex/link/poll', 'POST', {
      handle: start.handle,
    })
    const pollText = await pollRes.text()
    expect(pollText).not.toContain('refresh-1')
    expect(codexLinkPollResponseSchema.parse(JSON.parse(pollText)).status).toBe('linked')

    // Settings now show codex linked; still no secret in the payload.
    const settingsRes = await app.request('/api/ai/settings')
    const settingsText = await settingsRes.text()
    expect(settingsText).not.toContain('refresh-1')
    const parsed = aiSettingsResponseSchema.parse(JSON.parse(settingsText))
    const codex = parsed.statuses.find((s) => s.provider === 'openai-codex')!
    expect(codex.linked).toBe(true)
    expect(codex.unavailable).toBe(false)
  })

  it('a garbage / foreign handle → expired (restart)', async () => {
    mockOpenAi()
    const r = await json('/api/ai/providers/openai-codex/link/poll', 'POST', {
      handle: 'not-a-real-handle',
    })
    expect(codexLinkPollResponseSchema.parse(await r.json()).status).toBe('expired')
  })
})

describe('DELETE /providers/openai-codex/link', () => {
  it('unlinks the account → 204 and status flips back', async () => {
    mockOpenAi()
    const start = codexLinkStartResponseSchema.parse(
      await (await json('/api/ai/providers/openai-codex/link/start', 'POST', {})).json(),
    )
    await json('/api/ai/providers/openai-codex/link/poll', 'POST', { handle: start.handle })

    const del = await app.request('/api/ai/providers/openai-codex/link', { method: 'DELETE' })
    expect(del.status).toBe(204)
    const parsed = aiSettingsResponseSchema.parse(
      await (await app.request('/api/ai/settings')).json(),
    )
    expect(parsed.statuses.find((s) => s.provider === 'openai-codex')!.linked).toBe(false)
  })
})

describe('openai-codex refuses a PUT key (audit C9)', () => {
  it('PUT /providers/openai-codex/key → 400 (OAuth, not a key)', async () => {
    const r = await json('/api/ai/providers/openai-codex/key', 'PUT', { key: 'x' })
    expect(r.status).toBe(400)
  })
})

describe('GET /settings surfaces the kill-switch', () => {
  it('unavailable=true when the flag is OFF', async () => {
    delete process.env.ENGRAM_ENABLE_CODEX
    const parsed = aiSettingsResponseSchema.parse(
      await (await app.request('/api/ai/settings')).json(),
    )
    const codex = parsed.statuses.find((s) => s.provider === 'openai-codex')!
    expect(codex.unavailable).toBe(true)
    expect(codex.linked).toBe(false)
  })
})
