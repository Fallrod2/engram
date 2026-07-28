import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { app } from '../app'
import type { FetchFn } from '../ai/providers/types'
import {
  createDemoAuthClient,
  __setDemoAuthClientForTests,
  type DemoAuthClient,
} from '../auth/demo-client'
import { DEMO_RATE_LIMIT, __resetDemoRateLimitForTests } from './demo'

/**
 * `POST /api/demo/session` — the public demo login. Exercised through the REAL
 * app (so the auth gate, the profile middleware and the error envelope are all in
 * the loop) with GoTrue stubbed via the injectable client seam: no network, ever.
 *
 * The narrowness of the auth-gate exemption is pinned separately and exhaustively
 * in `http/auth.spec.ts`; here we only re-prove it end-to-end on the real router.
 */

const ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_JWT_SECRET', 'ENGRAM_AUTH_DISABLED'] as const
let snapshot: Record<string, string | undefined>

beforeEach(() => {
  snapshot = {}
  for (const k of ENV_KEYS) {
    snapshot[k] = process.env[k]
    delete process.env[k]
  }
  __resetDemoRateLimitForTests()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = snapshot[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  __setDemoAuthClientForTests(undefined)
  __resetDemoRateLimitForTests()
})

/** A stub that records how many times it was called AND with what (must be nothing). */
function stubClient(): DemoAuthClient & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    signIn(...args: unknown[]) {
      calls.push(args)
      return Promise.resolve({ accessToken: 'access-tok', refreshToken: 'refresh-tok' })
    },
  }
}

/** Bun's `typeof fetch` carries extras (`preconnect`); cast like the AI specs do. */
const stubFetch = (fn: (init: RequestInit | undefined) => Promise<Response>): FetchFn =>
  ((_url: string | URL | Request, init?: RequestInit) => fn(init)) as unknown as FetchFn

const post = (body?: unknown) =>
  app.request(
    '/api/demo/session',
    body === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )

describe('POST /api/demo/session', () => {
  it('demo configured → 200 with the session token pair', async () => {
    __setDemoAuthClientForTests(stubClient())
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accessToken: 'access-tok', refreshToken: 'refresh-tok' })
  })

  it('demo NOT configured → clean 503 demo_unavailable (never a 500)', async () => {
    __setDemoAuthClientForTests(null)
    const res = await post()
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('demo_unavailable')
  })

  it('/api/health reports demoLoginEnabled in step with the route', async () => {
    __setDemoAuthClientForTests(null)
    const off = (await (await app.request('/api/health')).json()) as { demoLoginEnabled: boolean }
    expect(off.demoLoginEnabled).toBe(false)
    __setDemoAuthClientForTests(stubClient())
    const on = (await (await app.request('/api/health')).json()) as { demoLoginEnabled: boolean }
    expect(on.demoLoginEnabled).toBe(true)
  })

  it('IGNORES the request body entirely — it is not a login proxy', async () => {
    const client = stubClient()
    __setDemoAuthClientForTests(client)
    const res = await post({
      email: 'attacker@example.com',
      password: 'hunter2',
      userId: '00000000-0000-0000-0000-000000000000',
    })
    expect(res.status).toBe(200)
    // Same session as an empty POST, and the client was called with NO argument:
    // there is no path from caller input to the credentials used upstream.
    expect(await res.json()).toEqual({ accessToken: 'access-tok', refreshToken: 'refresh-tok' })
    expect(client.calls).toEqual([[]])
  })

  it('a malformed JSON body changes nothing (still never parsed)', async () => {
    __setDemoAuthClientForTests(stubClient())
    const res = await app.request('/api/demo/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json at all',
    })
    expect(res.status).toBe(200)
  })

  it('rate limit: the budget is spent, then 429 rate_limited with Retry-After', async () => {
    __setDemoAuthClientForTests(stubClient())
    for (let i = 0; i < DEMO_RATE_LIMIT.max; i++) {
      expect((await post()).status).toBe(200)
    }
    const res = await post()
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('rate_limited')
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('an unconfigured demo is refused BEFORE the budget is spent', async () => {
    // A 503 must not be a way to burn the window for the legitimate visitors.
    __setDemoAuthClientForTests(null)
    for (let i = 0; i < DEMO_RATE_LIMIT.max + 5; i++) {
      expect((await post()).status).toBe(503)
    }
    __setDemoAuthClientForTests(stubClient())
    expect((await post()).status).toBe(200)
  })

  it('upstream refusal → 502, and the demo password leaks NOWHERE', async () => {
    const PASSWORD = 'sup3r-s3cret-demo-passphrase'
    // A real client over a stubbed fetch, so the password actually travels the
    // code path. GoTrue is made to answer 400 with a body echoing the credentials
    // back (it does quote the submitted email) — the worst realistic case.
    __setDemoAuthClientForTests(
      createDemoAuthClient({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        email: 'demo@example.com',
        password: PASSWORD,
        fetchFn: stubFetch((init) =>
          Promise.resolve(
            new Response(JSON.stringify({ error: 'invalid_grant', echo: String(init?.body) }), {
              status: 400,
            }),
          ),
        ),
      }),
    )
    const errSpy = spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    try {
      const res = await post()
      expect(res.status).toBe(502)
      const text = await res.text()
      expect(text).not.toContain(PASSWORD)
      expect(text).not.toContain('demo@example.com')
      expect(text).not.toContain('anon-key')
      const logged = [...errSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls]
        .flat()
        .map((v) => String(v))
        .join('\n')
      expect(logged).not.toContain(PASSWORD)
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  it('a network failure → 502 without leaking the password', async () => {
    const PASSWORD = 'another-secret'
    __setDemoAuthClientForTests(
      createDemoAuthClient({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        email: 'demo@example.com',
        password: PASSWORD,
        fetchFn: stubFetch(() =>
          Promise.reject(new Error(`connect ECONNREFUSED (password=${PASSWORD})`)),
        ),
      }),
    )
    const res = await post()
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(PASSWORD)
  })

  it('a 200 without a usable token pair is treated as a failure, not a session', async () => {
    __setDemoAuthClientForTests(
      createDemoAuthClient({
        url: 'https://project.supabase.co',
        anonKey: 'anon-key',
        email: 'demo@example.com',
        password: 'pw',
        fetchFn: stubFetch(() =>
          Promise.resolve(new Response(JSON.stringify({ access_token: 'a' }))),
        ),
      }),
    )
    expect((await post()).status).toBe(502)
  })

  it('stays reachable WITHOUT a token while the gate is enforced, unlike the rest', async () => {
    process.env.SUPABASE_JWT_SECRET = 'a-shared-secret-at-least-32-bytes-long!!'
    __setDemoAuthClientForTests(stubClient())
    expect((await post()).status).toBe(200)
    // Same app, same request minus the exemption: every other /api route 401s.
    expect((await app.request('/api/subjects')).status).toBe(401)
    expect((await app.request('/api/me')).status).toBe(401)
    // The exemption is METHOD- and PATH-exact: neighbours stay gated.
    expect((await app.request('/api/demo/session')).status).toBe(401) // GET
    expect((await app.request('/api/demo/session/', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/api/demo', { method: 'POST' })).status).toBe(401)
    expect((await app.request('/api/demo/sessions', { method: 'POST' })).status).toBe(401)
  })
})
