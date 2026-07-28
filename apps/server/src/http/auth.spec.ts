import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { createAuthMiddleware, isPublicRoute } from './auth'
import { ApiError } from './errors'

/**
 * Middleware behaviour (spec §6.1) via a throwaway Hono app. `process.env` is
 * snapshotted and restored around every case so nothing leaks into the other
 * specs sharing this bun process (which must keep running auth OFF).
 */

const SECRET = 'a-shared-secret-at-least-32-bytes-long!!'
const ENV_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_JWT_SECRET',
  'ENGRAM_AUTH_DISABLED',
  'VERCEL',
  'NODE_ENV',
] as const

let snapshot: Record<string, string | undefined>

beforeEach(() => {
  snapshot = {}
  for (const k of ENV_KEYS) {
    snapshot[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = snapshot[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** A fresh app + fresh middleware instance (isolated memo + warn flags). */
function makeApp() {
  const app = new Hono()
  app.use('/api/*', createAuthMiddleware())
  app.on(['GET', 'OPTIONS'], '/api/ping', (c) =>
    c.json({ ok: true, sub: c.get('authClaims')?.sub ?? null }),
  )
  app.get('/api/health', (c) => c.json({ status: 'ok' }))
  // Stand-ins for the real public route and its nearest neighbours, so a request
  // that PASSES the gate lands on a 200 handler and a request that does not can
  // only be answered by the middleware itself (401).
  app.all('/api/demo/session', (c) => c.json({ ok: true }))
  app.all('/api/demo/session/', (c) => c.json({ ok: true }))
  app.all('/api/demo/sessions', (c) => c.json({ ok: true }))
  app.all('/api/demo', (c) => c.json({ ok: true }))
  app.all('/api/health/', (c) => c.json({ ok: true }))
  app.all('/api/healthz', (c) => c.json({ ok: true }))
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(err.toResponse(), err.status as 401)
    return c.json({ error: { code: 'internal_error', message: 'boom' } }, 500)
  })
  return app
}

function hs(opts: { aud?: string; exp?: number | string } = {}) {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-uuid')
    .setAudience(opts.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '1h')
    .sign(new TextEncoder().encode(SECRET))
}

describe('createAuthMiddleware', () => {
  it('OFF (empty env) → 200 without a token', async () => {
    const res = await makeApp().request('/api/ping')
    expect(res.status).toBe(200)
  })

  it('ON but no Authorization header → 401 unauthorized', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'
    const res = await makeApp().request('/api/ping')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('unauthorized')
  })

  it('ON with a malformed header → 401', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'
    const app = makeApp()
    const basic = await app.request('/api/ping', { headers: { Authorization: 'Basic abc' } })
    expect(basic.status).toBe(401)
    const empty = await app.request('/api/ping', { headers: { Authorization: 'Bearer ' } })
    expect(empty.status).toBe(401)
  })

  it('ON with an invalid token → 401 (HS256 path)', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    const res = await makeApp().request('/api/ping', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    })
    expect(res.status).toBe(401)
  })

  it('ON with an expired token → 401', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    const token = await hs({ exp: Math.floor(Date.now() / 1000) - 60 })
    const res = await makeApp().request('/api/ping', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  it('ON with a wrong audience → 401 (audit §11)', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    const token = await hs({ aud: 'anon' })
    const res = await makeApp().request('/api/ping', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(401)
  })

  it('ON with a valid token → 200 and authClaims set', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET
    const token = await hs()
    const res = await makeApp().request('/api/ping', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { sub: string }
    expect(body.sub).toBe('user-uuid')
  })

  it('/api/health is public even when ON', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'
    const res = await makeApp().request('/api/health')
    expect(res.status).toBe(200)
  })

  it('OPTIONS preflight passes through even when ON', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'
    const res = await makeApp().request('/api/ping', { method: 'OPTIONS' })
    expect(res.status).toBe(200)
  })

  it('fail-closed: prod (VERCEL) without config → 500 per request (audit §6)', async () => {
    process.env.VERCEL = '1'
    const res = await makeApp().request('/api/ping')
    expect(res.status).toBe(500)
  })

  it('/api/health stays readable during a prod misconfig (spec §2.6)', async () => {
    // Same env as the fail-closed case above (misconfigured=true), but the probe
    // must NOT 500 — it is the public path ops curl to diagnose the outage.
    process.env.VERCEL = '1'
    const res = await makeApp().request('/api/health')
    expect(res.status).toBe(200)
  })

  it('POST /api/demo/session is public even when ON (the demo CTA holds no token)', async () => {
    process.env.SUPABASE_URL = 'https://x.supabase.co'
    const res = await makeApp().request('/api/demo/session', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  /**
   * THE breach test. The gate exempts exactly two (method, path) pairs; anything
   * else under `/api/*` must still 401 without a token. Enumerated as a table so
   * a future exemption cannot slip in unnoticed: a new public route has to be
   * added to `PUBLIC` here, in plain sight, or the "everything else is closed"
   * case fails.
   */
  describe('the exemption is a two-entry allowlist', () => {
    const PUBLIC: [string, string][] = [
      ['GET', '/api/health'],
      ['POST', '/api/demo/session'],
    ]

    const CLOSED: [string, string][] = [
      // Same path, other verbs — the exemption is method-scoped.
      ['GET', '/api/demo/session'],
      ['PUT', '/api/demo/session'],
      ['PATCH', '/api/demo/session'],
      ['DELETE', '/api/demo/session'],
      ['POST', '/api/health'],
      ['DELETE', '/api/health'],
      // Near-miss paths — the exemption is exact, not a prefix and not fuzzy.
      ['POST', '/api/demo/session/'],
      ['POST', '/api/demo/sessions'],
      ['POST', '/api/demo'],
      ['GET', '/api/demo'],
      ['GET', '/api/health/'],
      ['GET', '/api/healthz'],
      // A representative slice of the real API surface.
      ['GET', '/api/subjects'],
      ['GET', '/api/me'],
      ['GET', '/api/admin/users'],
      ['POST', '/api/review/queue'],
      ['GET', '/api/ping'],
    ]

    it('accepts exactly the two documented pairs and nothing else', () => {
      for (const [method, path] of PUBLIC) expect(isPublicRoute(method, path)).toBe(true)
      for (const [method, path] of CLOSED) expect(isPublicRoute(method, path)).toBe(false)
      // Casing is not normalised anywhere — a case-mangled probe stays closed.
      expect(isPublicRoute('post', '/api/demo/session')).toBe(false)
      expect(isPublicRoute('POST', '/API/DEMO/SESSION')).toBe(false)
    })

    it('with the gate ON, every non-exempt route 401s without a token', async () => {
      process.env.SUPABASE_URL = 'https://x.supabase.co'
      const app = makeApp()
      for (const [method, path] of CLOSED) {
        const res = await app.request(path, { method })
        expect(`${method} ${path} → ${res.status}`).toBe(`${method} ${path} → 401`)
      }
    })

    it('with the gate ON, the two exempt pairs pass through', async () => {
      process.env.SUPABASE_URL = 'https://x.supabase.co'
      const app = makeApp()
      for (const [method, path] of PUBLIC) {
        const res = await app.request(path, { method })
        expect(`${method} ${path} → ${res.status}`).toBe(`${method} ${path} → 200`)
      }
    })
  })

  it('bypass is logged loudly (audit §7)', async () => {
    process.env.ENGRAM_AUTH_DISABLED = '1'
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await makeApp().request('/api/ping')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
