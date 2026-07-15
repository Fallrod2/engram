/**
 * Opt-in proof of the ONE `admin.service.stats()` behaviour PGlite cannot catch:
 * a raw `Date` interpolated into a `sql` fragment crashes postgres-js (prepared
 * statements) while PGlite tolerates it. This regression (`GET /api/admin/stats`
 * returning 500 on real Postgres) is invisible under the fast `test:db` gate, so
 * it is proven here against a REAL local Supabase Postgres. Run via
 * `bun run test:db:pg`.
 *
 * Hard rules (A10): NEVER run DDL against anything but 127.0.0.1:54322; NEVER
 * touch the `auth` schema; NEVER call `sql.end()` (the shared handle is owned by
 * `postgres-driver.pgtest.ts`, which sorts LAST in the gate's glob).
 */
import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { adminStatsResponseSchema } from '@engram/shared'
import { db, sql } from './client'
import { resolveDatabaseUrl } from './paths'
import { resetDb, seedUserProfile } from '../test-support/harness'
import { stats } from '../services/admin.service'

// Never run destructive DDL against anything but the local Supabase database.
const { hostname, port } = new URL(resolveDatabaseUrl())
const isLocal = (hostname === '127.0.0.1' || hostname === 'localhost') && port === '54322'
if (!isLocal) {
  throw new Error(
    `test:db:pg refused: DATABASE_URL must point at the local Supabase DB ` +
      `(127.0.0.1/localhost:54322), got ${hostname}:${port}.`,
  )
}

beforeAll(async () => {
  // Rebuild only public/drizzle (idempotent if another pgtest already did it in
  // this process); auth is provisioned by supabase and must never be dropped.
  await sql.unsafe(
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
  )
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
})
afterEach(async () => {
  await resetDb(db)
})

describe('admin.service.stats — real Postgres (postgres-js prepared statements)', () => {
  it('runs without the raw-Date crash and counts the 7-day-active window', async () => {
    // Start from an EMPTY profile table: migration 0008 backfills a permanent
    // bootstrap admin (`20d58a6e-…`) and `beforeAll` re-runs migrate with no reset
    // before this first test, so without this clear `totals.users` would be 3 and
    // the fixture would carry that admin's (recent) last_seen_at into active7d.
    // Clearing it makes `recent`/`stale` the ONLY users the counts describe.
    await resetDb(db)
    // One user seen just now (active), one seen 30 days ago (inactive). The
    // active7d aggregate compares last_seen_at to a Date — the exact fragment
    // that threw before the `gte` fix.
    await seedUserProfile(db, { userId: 'recent', email: 'recent@local', lastSeenAt: new Date() })
    await seedUserProfile(db, {
      userId: 'stale',
      email: 'stale@local',
      lastSeenAt: new Date(Date.now() - 30 * 86_400_000),
    })

    const res = await stats(db)

    expect(res.totals.users).toBe(2)
    expect(res.totals.active7d).toBe(1) // only `recent` is within the window
    expect(res.signupsPerDay).toHaveLength(30)
    expect(res.generationsPerDay).toHaveLength(30)
    // The real contract guard: the shared Zod schema must parse the response.
    expect(() => adminStatsResponseSchema.parse(res)).not.toThrow()
  })
})
