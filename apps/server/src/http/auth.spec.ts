import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { createAuthMiddleware } from './auth'
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
