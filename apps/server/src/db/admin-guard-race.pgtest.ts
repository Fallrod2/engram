/**
 * Opt-in proof of the ONE last-admin guard behaviour PGlite cannot reproduce:
 * two admins demoting EACH OTHER concurrently must not both succeed (→ zero
 * admins, total lockout). PGlite runs on a single connection and serializes
 * transactions itself, so the race never appears there; only REAL Postgres with
 * a connection pool exhibits it. The `pg_advisory_xact_lock` in the guarded write
 * paths (admin.service `setRole`/`setStatus`/`deleteUser`) must serialize them so
 * the second demote recounts committed state and is refused. Run via
 * `bun run test:db:pg`.
 *
 * Hard rules (A10): NEVER run DDL against anything but 127.0.0.1:54322; NEVER
 * touch the `auth` schema; NEVER call `sql.end()` (owned by
 * `postgres-driver.pgtest.ts`, which sorts LAST in the gate's glob).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, sql } from './client'
import { resolveDatabaseUrl } from './paths'
import { userProfile } from './schema'
import { resetDb, seedUserProfile } from '../test-support/harness'
import { setRole } from '../services/admin.service'

// Never run destructive DDL against anything but the local Supabase database.
const { hostname, port } = new URL(resolveDatabaseUrl())
const isLocal = (hostname === '127.0.0.1' || hostname === 'localhost') && port === '54322'
if (!isLocal) {
  throw new Error(
    `test:db:pg refused: DATABASE_URL must point at the local Supabase DB ` +
      `(127.0.0.1/localhost:54322), got ${hostname}:${port}.`,
  )
}

// Force enforced auth with NO env admin so the effective admin set is DB-only
// (otherwise the permanent env filet would keep the set non-empty and no demote
// would ever be the "last admin"). Saved/restored so it never leaks to the next
// pgtest file in this shared process.
const ENV_KEYS = ['SUPABASE_JWT_SECRET', 'ENGRAM_ADMIN_USER_ID', 'ENGRAM_AUTH_DISABLED'] as const
const PREV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = 'a-shared-secret-at-least-32-bytes-long!!'
  delete process.env.ENGRAM_ADMIN_USER_ID
  delete process.env.ENGRAM_AUTH_DISABLED
  // Rebuild only public/drizzle (idempotent); auth is provisioned by supabase.
  await sql.unsafe(
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
  )
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
})
afterEach(async () => {
  await resetDb(db)
})
afterAll(() => {
  // Restore env for the following pgtest files. NEVER call sql.end() here.
  for (const k of ENV_KEYS) {
    const v = PREV[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('last-admin guard — real concurrency serialization (postgres-js pool)', () => {
  it('two concurrent mutual demotes of the last two admins → exactly one wins', async () => {
    await seedUserProfile(db, { userId: 'admin-a', role: 'admin' })
    await seedUserProfile(db, { userId: 'admin-b', role: 'admin' })

    // Each admin demotes the OTHER, at the same time, on distinct pooled
    // connections. WITHOUT the advisory lock both read a 2-admin set before either
    // commits and both pass → zero admins. WITH it, the second blocks, recounts a
    // single admin, and is refused.
    const results = await Promise.allSettled([
      setRole(db, 'admin-a', 'admin-b', 'user'),
      setRole(db, 'admin-b', 'admin-a', 'user'),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(String(rejected[0]!.reason?.message ?? rejected[0]!.reason)).toMatch(/last active admin/)

    // The decisive assertion: at least one admin survives → no lockout.
    const admins = await db.select().from(userProfile).where(eq(userProfile.role, 'admin'))
    expect(admins).toHaveLength(1)
  })
})
