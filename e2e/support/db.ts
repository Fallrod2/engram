import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

/**
 * Throwaway Postgres database for one e2e run (Phase 7 §1.4, amended for the
 * Supabase/Postgres migration handoff §14).
 *
 * The local Supabase stack (127.0.0.1:54322) also serves the orchestrator's live
 * servers on the default `postgres` database, so we NEVER touch its content: we
 * only `CREATE DATABASE` / `DROP DATABASE` a uniquely-named database on the same
 * instance (creating/dropping named databases is allowed; mutating `postgres`
 * is not). `db:reset` is never used here.
 *
 * `createRunDb()` runs in the BODY of `playwright.config.ts` (top-level await),
 * BEFORE Playwright freezes each `webServer.env` — so the migrated database URL
 * can be injected into the server env. `dropRunDb()` runs in `globalTeardown`.
 */

const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

function baseUrl(): URL {
  const raw =
    process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0
      ? process.env.DATABASE_URL
      : DEFAULT_URL
  return new URL(raw)
}

/** Hard guard: the e2e DB lives ONLY on the local Supabase instance. */
function assertLocal(u: URL): void {
  const isLocal = (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.port === '54322'
  if (!isLocal) {
    throw new Error(
      `e2e refuses a non-local DATABASE_URL (${u.hostname}:${u.port || '(default)'}). ` +
        'The throwaway database is only ever created on the local Supabase stack (127.0.0.1:54322).',
    )
  }
}

export interface RunDb {
  /** Connection string for the throwaway database (injected into webServer env). */
  url: string
  dbName: string
}

/**
 * Create + migrate the throwaway database. Migration reuses the REAL production
 * `migrate.ts` script (postgres-js migrator) as a subprocess with `DATABASE_URL`
 * pointing at the fresh database — highest fidelity, no schema drift.
 */
export async function createRunDb(): Promise<RunDb> {
  const base = baseUrl()
  assertLocal(base)

  // Digits + underscore only → a safe unquoted Postgres identifier.
  const dbName = `engram_e2e_${Date.now()}_${process.pid}`

  const adminUrl = new URL(base.toString())
  adminUrl.pathname = '/postgres'
  const e2eUrl = new URL(base.toString())
  e2eUrl.pathname = `/${dbName}`

  const admin = postgres(adminUrl.toString(), { max: 1 })
  try {
    await admin.unsafe(`CREATE DATABASE ${dbName}`)
  } finally {
    await admin.end()
  }

  const migrateScript = fileURLToPath(
    new URL('../../apps/server/src/db/migrate.ts', import.meta.url),
  )
  execFileSync('bun', [migrateScript], {
    env: { ...process.env, DATABASE_URL: e2eUrl.toString() },
    stdio: 'inherit',
  })

  // Stash for the teardown (a separate module load in the SAME process).
  process.env.E2E_DB_NAME = dbName
  process.env.E2E_ADMIN_URL = adminUrl.toString()

  return { url: e2eUrl.toString(), dbName }
}

/** Terminate lingering connections and drop the throwaway database. */
export async function dropRunDb(): Promise<void> {
  const dbName = process.env.E2E_DB_NAME
  const adminUrl = process.env.E2E_ADMIN_URL
  if (!dbName || !adminUrl) return

  const admin = postgres(adminUrl, { max: 1 })
  try {
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
        `WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`,
    )
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName}`)
  } finally {
    await admin.end()
  }
}
