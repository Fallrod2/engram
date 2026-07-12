/** Default local Supabase Postgres URL (CLI default DB port). */
export const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * The Postgres connection string, read from `DATABASE_URL`, falling back to the
 * local Supabase stack. Pure: no driver import, so it can be shared by
 * `drizzle.config.ts`, the runtime client, and the migrate/reset scripts.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  return url && url.length > 0 ? url : DEFAULT_DATABASE_URL
}
