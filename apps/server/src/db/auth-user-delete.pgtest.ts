/**
 * Opt-in proof of the ONE behaviour PGlite cannot reproduce: the best-effort
 * GoTrue `auth.users` delete inside the GDPR user-deletion (spec §5.2, amendment
 * A10). PGlite has no Supabase `auth` schema, so `authDeleted` is always false
 * there; only a REAL local Supabase (Docker up, port 54322) has the schema and
 * the owner grant to write it. Run via `bun run test:db:pg`.
 *
 * Hard rules (A10): NEVER run DDL against anything but 127.0.0.1:54322; NEVER
 * touch the `auth` schema with DDL (it is provisioned by `supabase start` and the
 * stack is never reset); DELETE the seeded `auth.users` row in `afterAll` even on
 * failure (the local Supabase is shared). The shared `sql.end()` is owned by
 * `postgres-driver.pgtest.ts`, which sorts AFTER this file in the gate's glob.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { sql as dsql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, sql } from './client'
import { resolveDatabaseUrl } from './paths'
import { resetDb, seedCard, seedDeck, seedSubject, seedUserProfile } from '../test-support/harness'
import { deleteUser } from '../services/admin.service'

// Never run destructive DDL against anything but the local Supabase database.
const { hostname, port } = new URL(resolveDatabaseUrl())
const isLocal = (hostname === '127.0.0.1' || hostname === 'localhost') && port === '54322'
if (!isLocal) {
  throw new Error(
    `test:db:pg refused: DATABASE_URL must point at the local Supabase DB ` +
      `(127.0.0.1/localhost:54322), got ${hostname}:${port}.`,
  )
}

const VICTIM = '11111111-2222-3333-4444-555555555555'
let canWriteAuth = false

/** Seed a bare `auth.users` row (id only — every other column is nullable/defaulted). */
async function seedAuthUser(id: string): Promise<void> {
  await sql.unsafe(`insert into auth.users (id) values ('${id}') on conflict (id) do nothing`)
}
async function authUserExists(id: string): Promise<boolean> {
  const rows = await sql.unsafe(`select 1 from auth.users where id = '${id}'`)
  return rows.length > 0
}

beforeAll(async () => {
  // Rebuild ONLY the public/drizzle schemas — auth is provisioned by supabase and
  // must never be dropped. Idempotent: safe whether or not another pgtest already
  // rebuilt it in this process.
  await sql.unsafe(
    'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
  )
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })

  // Verify the postgres role can actually write auth.users (local Supabase grant),
  // and fail with an explicit message otherwise instead of a cryptic later error.
  try {
    await seedAuthUser(VICTIM)
    canWriteAuth = await authUserExists(VICTIM)
    await sql.unsafe(`delete from auth.users where id = '${VICTIM}'`)
  } catch (e) {
    throw new Error(
      `Cannot write auth.users as the postgres role on local Supabase — ` +
        `is the stack up (supabase start)? Original: ${(e as Error).message}`,
    )
  }
  if (!canWriteAuth) {
    throw new Error(
      'Seed probe failed: auth.users row did not persist (unexpected on local Supabase).',
    )
  }
})
afterEach(async () => {
  await resetDb(db)
  await sql.unsafe(`delete from auth.users where id = '${VICTIM}'`)
})
afterAll(async () => {
  // Belt-and-suspenders: never leave a seeded row behind in the shared stack.
  await sql.unsafe(`delete from auth.users where id = '${VICTIM}'`)
})

describe('deleteUser — best-effort auth.users removal (real Postgres)', () => {
  it('to_regclass probes the schema, then deletes the matching auth.users row', async () => {
    // A real auth.users row + a full public footprint for the victim.
    await seedAuthUser(VICTIM)
    await seedUserProfile(db, { userId: VICTIM, email: 'victim@local' })
    const s = await seedSubject(db, { userId: VICTIM })
    const d = await seedDeck(db, s.id, { userId: VICTIM })
    await seedCard(db, d.id, { userId: VICTIM })

    expect(await authUserExists(VICTIM)).toBe(true)
    const res = await deleteUser(db, 'admin-actor', VICTIM)

    expect(res.authDeleted).toBe(true) // the uuid + probe + owner grant all hold here
    expect(res.deletedCounts.subjects).toBe(1)
    expect(await authUserExists(VICTIM)).toBe(false) // login revoked
  })

  it('to_regclass returns a class on this DB (auth.users present)', async () => {
    const rows = await db.execute(dsql`select to_regclass('auth.users') is not null as present`)
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])
    expect((list[0] as { present: boolean }).present).toBe(true)
  })
})
