import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createTestDb, type TestDb } from './test-db'

/**
 * Migration 0010 removes the Supabase Data API surface: `anon` and
 * `authenticated` must hold NO privilege on `public`, on the tables that exist
 * today AND on the ones a future migration will create.
 *
 * The difficulty is that the roles do not exist on PGlite (nor on the bare
 * Postgres of the e2e harness), so a naive "assert anon has nothing" test would
 * pass forever without ever exercising a single REVOKE. This spec therefore
 * BUILDS the roles instead of skipping: `supabaseLikeDb()` reproduces a stock
 * Supabase project in-process (the two Data API roles, USAGE on `public`, and
 * the `ALTER DEFAULT PRIVILEGES` that hand every future table to them), then
 * replays the whole migration chain on top.
 *
 * Three independent safeguards keep the suite from going vacuous:
 *  1. the NEGATIVE CONTROL below proves the fixture really does leak without
 *     0010 — if the grant setup ever stops taking effect, that test fails first;
 *  2. `service_role` is asserted to KEEP its grants, so an over-broad revoke (or
 *     a fixture that grants nothing at all) is caught;
 *  3. the table list is asserted non-trivial, so an empty `pg_tables` scan can
 *     never be mistaken for "nothing is exposed".
 */

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** The two Supabase Data API roles — reachable with the PUBLIC `anon` key. */
const DATA_API_ROLES = ['anon', 'authenticated'] as const

/** Everything `GRANT ALL ON TABLE` hands out (the `arwdDxtm` ACL bits). */
const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
] as const

/** The stock Supabase grants, replayed in-process so 0010 has something to undo. */
const SUPABASE_STOCK_GRANTS = `
  CREATE ROLE anon NOLOGIN NOINHERIT;
  CREATE ROLE authenticated NOLOGIN NOINHERIT;
  CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
`

/** A PGlite that looks like a fresh Supabase project, migrations NOT yet applied. */
async function supabaseLikeDb(): Promise<PGlite> {
  const client = new PGlite()
  await client.exec(SUPABASE_STOCK_GRANTS)
  return client
}

async function scalar<T>(client: PGlite, query: string): Promise<T> {
  const { rows } = await client.query<Record<string, T>>(query)
  return Object.values(rows[0] ?? {})[0] as T
}

async function publicTables(client: PGlite): Promise<string[]> {
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  )
  return rows.map((r) => r.tablename)
}

describe('migration 0010 — negative control (the fixture really is vulnerable)', () => {
  it('leaks a brand-new table to anon when 0010 has NOT run', async () => {
    const client = await supabaseLikeDb()
    try {
      await client.exec('CREATE TABLE public.leak_probe (id int PRIMARY KEY, secret text);')
      // Straight from `ALTER DEFAULT PRIVILEGES` — no GRANT was issued on this table.
      expect(
        await scalar<boolean>(
          client,
          `SELECT has_table_privilege('anon', 'public.leak_probe', 'SELECT')`,
        ),
      ).toBe(true)
      expect(
        await scalar<boolean>(
          client,
          `SELECT has_table_privilege('authenticated', 'public.leak_probe', 'INSERT')`,
        ),
      ).toBe(true)
    } finally {
      await client.close()
    }
  })
})

describe('migration 0010 — anon/authenticated hold nothing on public', () => {
  let client: PGlite

  beforeEach(async () => {
    client = await supabaseLikeDb()
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
  })
  afterEach(async () => {
    await client.close()
  })

  it('applies on a database where the Data API roles DO exist', async () => {
    for (const role of DATA_API_ROLES) {
      expect(
        await scalar<boolean>(
          client,
          `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}')`,
        ),
      ).toBe(true)
    }
  })

  it('strips every privilege on every existing table of public', async () => {
    const tables = await publicTables(client)
    // Guard: an empty scan must never read as "nothing is exposed".
    expect(tables.length).toBeGreaterThanOrEqual(15)

    const held: string[] = []
    for (const table of tables) {
      for (const role of DATA_API_ROLES) {
        for (const privilege of TABLE_PRIVILEGES) {
          const has = await scalar<boolean>(
            client,
            `SELECT has_table_privilege('${role}', 'public.${table}', '${privilege}')`,
          )
          if (has) held.push(`${role} ${privilege} ON ${table}`)
        }
      }
    }
    expect(held).toEqual([])
  })

  it('leaves no default privilege that would re-grant a FUTURE table', async () => {
    await client.exec('CREATE TABLE public.future_probe (id int PRIMARY KEY, secret text);')
    for (const role of DATA_API_ROLES) {
      expect(
        await scalar<boolean>(
          client,
          `SELECT has_table_privilege('${role}', 'public.future_probe', 'SELECT')`,
        ),
      ).toBe(false)
    }

    const { rows } = await client.query<{ acl: string }>(
      `SELECT unnest(defaclacl)::text AS acl FROM pg_default_acl
        WHERE defaclnamespace = 'public'::regnamespace`,
    )
    const leftovers = rows.map((r) => r.acl).filter((acl) => /^(anon|authenticated)=/.test(acl))
    expect(leftovers).toEqual([])
  })

  it('leaves service_role untouched — its key is secret and the tooling needs it', async () => {
    expect(
      await scalar<boolean>(
        client,
        `SELECT has_table_privilege('service_role', 'public.card', 'SELECT')`,
      ),
    ).toBe(true)
    await client.exec('CREATE TABLE public.service_probe (id int PRIMARY KEY);')
    expect(
      await scalar<boolean>(
        client,
        `SELECT has_table_privilege('service_role', 'public.service_probe', 'SELECT')`,
      ),
    ).toBe(true)
  })

  it('is re-runnable: replaying the chain changes nothing and raises nothing', async () => {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
    expect(
      await scalar<boolean>(client, `SELECT has_table_privilege('anon', 'public.card', 'SELECT')`),
    ).toBe(false)
  })
})

describe('migration 0010 — portability where the roles do NOT exist', () => {
  let t: TestDb

  beforeEach(async () => {
    t = await createTestDb()
  })
  afterEach(async () => {
    await t.cleanup()
  })

  it('applies on a plain Postgres that has neither anon nor authenticated', async () => {
    // `createTestDb()` already ran the whole chain; reaching here means 0010 did
    // not raise 42704. Assert the premise so this stays an honest statement.
    for (const role of DATA_API_ROLES) {
      const { rows } = await t.client.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') AS exists`,
      )
      expect(rows[0]?.exists).toBe(false)
    }
    expect((await publicTables(t.client)).length).toBeGreaterThanOrEqual(15)
  })
})
