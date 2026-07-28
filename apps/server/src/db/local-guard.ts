/**
 * Shared "local Postgres only" guard for the destructive database tooling:
 * `db:reset`, the opt-in `*.pgtest.ts` suites and `scripts/generate-landing-shots.ts`
 * all run `DROP SCHEMA` / `CREATE DATABASE`, so none of them may ever reach the
 * Supabase cloud project.
 *
 * The invariant is on the HOST, never on the port. A local database can
 * legitimately answer anywhere: the Supabase CLI stack uses 54322, but a second
 * stack, a `docker run -p 5433:5432 postgres` or a system Postgres on 5432 are
 * exactly as safe — while the cloud project can never be reached on a loopback
 * host. Pinning the port protected nothing and broke every non-default local
 * setup, so it is the hostname alone that is checked.
 *
 * `e2e/support/db.ts` implements the same semantics with its own copy, on
 * purpose: the e2e harness must not import from `apps/server`.
 */

/** `new URL()` keeps IPv6 hosts bracketed (`[::1]`); accept the bare form too. */
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** True only for a loopback host — any port, any database name, any credentials. */
export function isLocalDatabaseUrl(raw: string): boolean {
  const url = parseUrl(raw)
  return url !== null && LOCAL_HOSTNAMES.has(url.hostname)
}

/** `host:port` — the diagnostic half of a connection string, never its credentials. */
export function describeDatabaseHost(raw: string): string {
  const url = parseUrl(raw)
  if (!url) return 'an unparsable connection string'
  return `${url.hostname}:${url.port || '(default port)'}`
}

/**
 * The refusal message, so callers that must exit non-zero rather than throw
 * (`db:reset`) print exactly what the throwing callers do.
 */
export function localDatabaseUrlRefusal(
  raw: string,
  tool: string,
  envVar = 'DATABASE_URL',
): string {
  return (
    `${tool} refused: ${envVar} points at ${describeDatabaseHost(raw)}. ` +
    'This tool DROPs and CREATEs schemas or databases, so it only ever runs against a local ' +
    'Postgres (127.0.0.1, localhost or ::1, on any port) and never against the Supabase cloud ' +
    `project. Start the local stack with \`bun run dev:db\` (supabase start), or point ${envVar} ` +
    'at another local instance.'
  )
}

/** Throwing form of the guard, for the tooling that runs at module load. */
export function assertLocalDatabaseUrl(raw: string, tool: string, envVar = 'DATABASE_URL'): void {
  if (!isLocalDatabaseUrl(raw)) throw new Error(localDatabaseUrlRefusal(raw, tool, envVar))
}
