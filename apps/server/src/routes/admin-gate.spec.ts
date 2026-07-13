import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { app } from '../app'
import { db } from '../db/client'
import { resetDb } from '../test-support/harness'

/**
 * Admin-gate (spec §3). The AI write/test routes and every backup route are
 * admin-only. Under the dev bypass (bun:test has no auth env) the default
 * identity IS the admin, so the routes work — UNLESS `ENGRAM_ADMIN_USER_ID` names
 * a DIFFERENT user, which is how we simulate a non-admin caller here. Read routes
 * (GET settings/models) stay open to everyone.
 */

const PREV = process.env.ENGRAM_ADMIN_USER_ID

beforeEach(async () => {
  await resetDb(db)
})
afterEach(() => {
  if (PREV === undefined) delete process.env.ENGRAM_ADMIN_USER_ID
  else process.env.ENGRAM_ADMIN_USER_ID = PREV
})

/** Point the admin at someone OTHER than the dev identity → the caller is non-admin. */
function asNonAdmin() {
  process.env.ENGRAM_ADMIN_USER_ID = 'someone-else-entirely'
}

const json = (path: string, method: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

async function expectForbidden(res: Response) {
  expect(res.status).toBe(403)
  const body = (await res.json()) as { error: { code: string } }
  expect(body.error.code).toBe('forbidden')
}

describe('AI config routes — admin only for writes', () => {
  it('non-admin → 403 on PATCH /settings, PUT/DELETE key, POST test', async () => {
    asNonAdmin()
    await expectForbidden(await json('/api/ai/settings', 'PATCH', { activeProvider: 'ollama' }))
    await expectForbidden(await json('/api/ai/providers/openrouter/key', 'PUT', { key: 'x' }))
    await expectForbidden(
      await app.request('/api/ai/providers/openrouter/key', { method: 'DELETE' }),
    )
    await expectForbidden(await json('/api/ai/providers/ollama/test', 'POST', {}))
  })

  it('admin (dev identity) → writes succeed', async () => {
    // No ENGRAM_ADMIN_USER_ID → the dev identity is the admin.
    const r = await json('/api/ai/settings', 'PATCH', { activeProvider: 'ollama' })
    expect(r.status).toBe(200)
    const put = await json('/api/ai/providers/openrouter/key', 'PUT', { key: 'k' })
    expect(put.status).toBe(204)
  })

  it('GET /settings and /models stay readable for a non-admin', async () => {
    asNonAdmin()
    expect((await app.request('/api/ai/settings')).status).toBe(200)
    expect((await app.request('/api/ai/providers/anthropic/models')).status).toBe(200)
  })
})

describe('backup routes — admin only', () => {
  it('non-admin → 403 on export and import', async () => {
    asNonAdmin()
    await expectForbidden(await app.request('/api/backup/export'))
    await expectForbidden(await json('/api/backup/import', 'POST', { engramBackup: 1 }))
  })

  it('admin (dev identity) → export succeeds', async () => {
    const r = await app.request('/api/backup/export')
    expect(r.status).toBe(200)
  })
})
