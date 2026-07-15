import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { SignJWT } from 'jose'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb, seedUserProfile } from '../test-support/harness'

/**
 * Route-level authorization after the BYOK per-user switch (spec BYOK §1.3,
 * amendments §5/§6):
 *
 * - The AI config WRITE routes are NO LONGER admin-only — any authenticated user
 *   configures THEIR OWN provider. The only exclusion is the demo account, which
 *   reads the admin config but must not write it (`requireNotDemo` → 403). POST
 *   test stays permitted for the demo (it resolves via the admin alias).
 * - The BACKUP routes stay admin-only in v1 (export of ALL data): a non-admin
 *   caller → 403.
 *
 * Under the bun:test bypass (no auth env) the default identity is the admin, so
 * the happy paths work; we simulate other callers by mutating the auth env.
 */

const SECRET = 'a-shared-secret-at-least-32-bytes-long!!'
const ENV_KEYS = [
  'ENGRAM_ADMIN_USER_ID',
  'ENGRAM_DEMO_USER_ID',
  'ENGRAM_DEV_USER_ID',
  'SUPABASE_JWT_SECRET',
] as const
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(async () => {
  await resetDb(db)
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = PREV[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

const json = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

async function expectForbidden(res: Response) {
  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe('forbidden')
}

/** Point the admin at someone OTHER than the dev identity → the caller is non-admin. */
function asNonAdmin() {
  process.env.ENGRAM_ADMIN_USER_ID = 'someone-else-entirely'
}

/** Sign an HS256 token for a given sub (enables enforced auth for that request). */
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

describe('AI config writes — any authenticated user (admin gate removed)', () => {
  it('the dev identity (admin) can write', async () => {
    const r = await json('/api/ai/settings', 'PATCH', { activeProvider: 'ollama' })
    expect(r.status).toBe(200)
    const put = await json('/api/ai/providers/openrouter/key', 'PUT', { key: 'k' })
    expect(put.status).toBe(204)
  })

  it('a NON-admin authenticated user can also write their own config', async () => {
    // Enforced auth (HS256), no ENGRAM_ADMIN_USER_ID → this user is NOT the admin,
    // yet the write must succeed: config is per-user now.
    process.env.SUPABASE_JWT_SECRET = SECRET
    const h = await bearer('some-public-signup-uuid')
    const r = await json('/api/ai/settings', 'PATCH', { activeProvider: 'mistral' }, h)
    expect(r.status).toBe(200)
    const put = await json('/api/ai/providers/mistral/key', 'PUT', { key: 'my-own-key' }, h)
    expect(put.status).toBe(204)
  })
})

describe('AI config writes — blocked for the demo account (read-only)', () => {
  function asDemo() {
    process.env.ENGRAM_DEMO_USER_ID = 'demo-user'
    process.env.ENGRAM_DEV_USER_ID = 'demo-user' // default bypass identity = demo
  }

  it('demo → 403 on PATCH /settings and PUT/DELETE key', async () => {
    asDemo()
    await expectForbidden(await json('/api/ai/settings', 'PATCH', { activeProvider: 'ollama' }))
    await expectForbidden(await json('/api/ai/providers/openrouter/key', 'PUT', { key: 'x' }))
    await expectForbidden(
      await app.request('/api/ai/providers/openrouter/key', { method: 'DELETE' }),
    )
  })

  it('demo → GET /settings and POST test stay allowed', async () => {
    asDemo()
    expect((await app.request('/api/ai/settings')).status).toBe(200)
    // ollama test needs no key/network guard to reach the handler (returns ok/false).
    const test = await json('/api/ai/providers/ollama/test', 'POST', {})
    expect(test.status).toBe(200)
  })
})

describe('backup routes — admin only (v1)', () => {
  it('non-admin → 403 on export and import', async () => {
    asNonAdmin()
    await expectForbidden(await app.request('/api/backup/export'))
    await expectForbidden(await json('/api/backup/import', 'POST', { engramBackup: 1 }))
  })

  it('admin (dev identity) → export succeeds', async () => {
    const r = await app.request('/api/backup/export')
    expect(r.status).toBe(200)
  })

  // The admin gate now resolves via the DB profile (spec §3, amendment A9): a user
  // promoted to admin IN THE DB reaches the admin-only backup WITHOUT any env var.
  it('a DB-promoted admin reaches backup export with NO env admin set', async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET // enforced; no ENGRAM_ADMIN_USER_ID
    await seedUserProfile(db, { userId: 'db-admin', role: 'admin' })
    const h = await bearer('db-admin')
    const ok = await app.request('/api/backup/export', { headers: h })
    expect(ok.status).toBe(200)
    // A plain DB user (no env filet, role user) stays blocked.
    await seedUserProfile(db, { userId: 'db-user' })
    const denied = await app.request('/api/backup/export', { headers: await bearer('db-user') })
    expect(denied.status).toBe(403)
  })
})
