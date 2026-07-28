import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

/**
 * Throwaway Postgres database for one e2e run (Phase 7 §1.4, amended for the
 * Supabase/Postgres migration handoff §14).
 *
 * This module runs `CREATE DATABASE` / `DROP DATABASE`, so it must NEVER target
 * the Supabase cloud project. The guard below therefore refuses any non-local
 * host — but it accepts ANY local Postgres, on any port: the throwaway database
 * only needs a local instance, and 127.0.0.1:54322 is merely the usual one (the
 * local Supabase CLI stack, started by `bun run dev:db`). We only ever
 * create/drop a uniquely-named database; the instance's own databases are never
 * mutated and `db:reset` is never used here.
 *
 * `createRunDb()` runs in the BODY of `playwright.config.ts` (top-level await),
 * BEFORE Playwright freezes each `webServer.env` — so the migrated database URL
 * can be injected into the server env. `dropRunDb()` runs in `globalTeardown`.
 */

/** The local Supabase CLI stack (`bun run dev:db`), and what the hint below maps to. */
const DEFAULT_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** `new URL()` keeps IPv6 hosts bracketed (`[::1]`); accept the bare form too. */
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

const DOCKER_HINT =
  'docker run --rm -d -p 54322:5432 -e POSTGRES_PASSWORD=postgres --name engram-e2e postgres:16'

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

function isLocal(u: URL): boolean {
  return LOCAL_HOSTNAMES.has(u.hostname)
}

/** Connection string with the password masked, safe to put in an error message. */
function redact(raw: string): string {
  const u = parseUrl(raw)
  if (!u) return raw
  if (u.password) u.password = '***'
  return u.toString()
}

function rejectNonLocal(raw: string): never {
  const u = parseUrl(raw)
  const where = u
    ? `${u.hostname}:${u.port || '(default port)'}`
    : 'an unparsable connection string'
  throw new Error(
    `e2e refuses E2E_DATABASE_URL pointing at ${where}. ` +
      'The e2e harness CREATEs and DROPs a throwaway database, so it only ever runs against a ' +
      'local Postgres (127.0.0.1, localhost or ::1, any port) and never against the Supabase ' +
      `cloud project. Set E2E_DATABASE_URL to a local instance, or start one with: ${DOCKER_HINT}`,
  )
}

/**
 * Resolve the base connection string for the throwaway database.
 *
 * 1. `E2E_DATABASE_URL` — the dedicated variable; a non-local value is a hard error.
 * 2. `DATABASE_URL` — used ONLY when local. In normal dev it points at the cloud
 *    project, and silently inheriting that would be both unsafe and confusing, so
 *    a non-local (or unparsable) value is ignored without error.
 * 3. The local Supabase CLI stack default (`127.0.0.1:54322`).
 *
 * Pure and env-injected so the guard is unit-testable without touching `process.env`.
 */
export function resolveE2eDatabaseUrl(env: Record<string, string | undefined>): string {
  const explicit = env.E2E_DATABASE_URL
  if (explicit) {
    const u = parseUrl(explicit)
    if (!u || !isLocal(u)) rejectNonLocal(explicit)
    return explicit
  }

  const inherited = env.DATABASE_URL
  if (inherited) {
    const u = parseUrl(inherited)
    if (u && isLocal(u)) return inherited
  }

  return DEFAULT_URL
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
])

function isConnectionFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)
}

/**
 * Turn a bare `ECONNREFUSED` (raised from the top-level await of
 * `playwright.config.ts`, where it arrives without any context) into something
 * actionable, keeping the original error as `cause`.
 */
function connectionError(url: string, cause: unknown): Error {
  return new Error(
    `e2e could not reach a Postgres at ${redact(url)}. ` +
      'The e2e harness needs a local Postgres it can CREATE/DROP a throwaway database on; ' +
      'it never uses the Supabase cloud project. Start a disposable one with: ' +
      `${DOCKER_HINT} — or point E2E_DATABASE_URL at an existing local instance.`,
    { cause },
  )
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
  const base = new URL(resolveE2eDatabaseUrl(process.env))

  // Digits + underscore only → a safe unquoted Postgres identifier.
  const dbName = `engram_e2e_${Date.now()}_${process.pid}`

  const adminUrl = new URL(base.toString())
  adminUrl.pathname = '/postgres'
  const e2eUrl = new URL(base.toString())
  e2eUrl.pathname = `/${dbName}`

  const admin = postgres(adminUrl.toString(), { max: 1 })
  try {
    await admin.unsafe(`CREATE DATABASE ${dbName}`)
  } catch (error) {
    if (isConnectionFailure(error)) throw connectionError(adminUrl.toString(), error)
    throw error
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
