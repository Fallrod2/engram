/** Default local Supabase Postgres URL (CLI default DB port). */
export const DEFAULT_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/**
 * The Postgres connection string, read from `DATABASE_URL` (or `POSTGRES_URL`,
 * the name injected by the Vercel×Supabase marketplace integration), falling
 * back to the local Supabase stack. Pure: no driver import, so it can be shared
 * by `drizzle.config.ts`, the runtime client, and the migrate/reset scripts.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL
  return url && url.length > 0 ? url : DEFAULT_DATABASE_URL
}

/**
 * Connection string for migrations: prefers the direct (non-pooled) connection
 * when the platform provides one — DDL through a transaction-mode pooler is
 * best avoided — and otherwise falls back to the runtime URL.
 */
export function resolveMigrationDatabaseUrl(): string {
  const direct = process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL_UNPOOLED
  return direct && direct.length > 0 ? direct : resolveDatabaseUrl()
}
