import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../db/test-db'
import { DEFAULT_DEV_USER_ID as U } from '../auth/config'
import { aiCredential } from '../db/schema'
import { resolveCodexAccess } from './codex-access.service'
import type { FetchFn } from '../ai/providers/types'

/**
 * `resolveCodexAccess` refresh/lock behaviour (audit B6/B8). Uses a PGlite DB and
 * an injected fetch, so no network. Proves: fresh → no refresh; within-margin →
 * refresh + persist; invalid_grant → unlink; transient error → keep; and the
 * re-read guard (a second call after a refresh reuses the stored token).
 */

let t: TestDb
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(async () => {
  await t.cleanup()
})

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Count refresh calls so we can assert "only once". */
function countingFetch(res: () => Response): { fetchFn: FetchFn; count: () => number } {
  let n = 0
  const fetchFn = (async () => {
    n += 1
    return res()
  }) as unknown as FetchFn
  return { fetchFn, count: () => n }
}

async function seed(expiresAt: Date | null, refreshToken: string | null = 'refresh-1') {
  await t.db.insert(aiCredential).values({
    userId: U,
    provider: 'openai-codex',
    secret: 'old-access',
    refreshToken,
    expiresAt,
    accountId: 'acct-1',
  })
}
async function readRow() {
  const [row] = await t.db
    .select()
    .from(aiCredential)
    .where(and(eq(aiCredential.userId, U), eq(aiCredential.provider, 'openai-codex')))
  return row
}

describe('resolveCodexAccess', () => {
  it('returns null when there is no credential', async () => {
    expect(await resolveCodexAccess(t.db, U)).toBeNull()
  })

  it('a fresh token is returned WITHOUT a refresh call', async () => {
    await seed(new Date(Date.now() + 3600_000))
    const { fetchFn, count } = countingFetch(() => json({}))
    const access = await resolveCodexAccess(t.db, U, fetchFn)
    expect(access).toEqual({ accessToken: 'old-access', accountId: 'acct-1' })
    expect(count()).toBe(0)
  })

  it('a within-margin token is refreshed and persisted', async () => {
    await seed(new Date(Date.now() + 60_000)) // < 5-min margin
    const newAccess = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    const access = await resolveCodexAccess(
      t.db,
      U,
      countingFetch(() => json({ access_token: newAccess, refresh_token: 'refresh-2' })).fetchFn,
    )
    expect(access?.accessToken).toBe(newAccess)
    const row = await readRow()
    expect(row?.secret).toBe(newAccess)
    expect(row?.refreshToken).toBe('refresh-2') // rotated
  })

  it('invalid_grant deletes the credential (unlink) and returns null', async () => {
    await seed(new Date(Date.now() + 60_000))
    const access = await resolveCodexAccess(
      t.db,
      U,
      countingFetch(() => new Response('', { status: 400 })).fetchFn,
    )
    expect(access).toBeNull()
    expect(await readRow()).toBeUndefined()
  })

  it('a transient error KEEPS the credential and reuses a not-yet-hard-expired token', async () => {
    await seed(new Date(Date.now() + 60_000)) // in margin, not hard-expired
    const access = await resolveCodexAccess(
      t.db,
      U,
      countingFetch(() => new Response('', { status: 502 })).fetchFn,
    )
    expect(access).toEqual({ accessToken: 'old-access', accountId: 'acct-1' })
    expect(await readRow()).toBeDefined() // not unlinked
  })

  it('a transient error with a HARD-expired token returns null (still keeps the row)', async () => {
    await seed(new Date(Date.now() - 1000)) // already expired
    const access = await resolveCodexAccess(
      t.db,
      U,
      countingFetch(() => new Response('', { status: 502 })).fetchFn,
    )
    expect(access).toBeNull()
    expect(await readRow()).toBeDefined()
  })

  it('re-read guard: after one refresh the token is fresh → a 2nd call does NOT refresh', async () => {
    await seed(new Date(Date.now() + 60_000))
    const newAccess = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    const { fetchFn, count } = countingFetch(() =>
      json({ access_token: newAccess, refresh_token: 'refresh-2' }),
    )
    await resolveCodexAccess(t.db, U, fetchFn)
    const second = await resolveCodexAccess(t.db, U, fetchFn)
    expect(second?.accessToken).toBe(newAccess)
    expect(count()).toBe(1) // only the first call refreshed
  })
})
