import postgres from 'postgres'
import { isLocalDatabaseUrl, localDatabaseUrlRefusal } from './local-guard'
import { resolveDatabaseUrl } from './paths'

/**
 * Destructive LOCAL reset. Drops and recreates the `public` schema plus the
 * drizzle bookkeeping schema so a regenerated baseline migration re-applies
 * from scratch (a regenerated `0000_*.sql` otherwise collides with the tables
 * an earlier baseline already created → `42P07 relation already exists`).
 *
 * Guard rail: refuses to run unless `DATABASE_URL` points at a LOCAL Postgres
 * (any port — see `local-guard.ts`), so this can never fire against the cloud
 * project, even by accident. Chained with `db:migrate` by the `db:reset` script.
 */
const url = resolveDatabaseUrl()
if (!isLocalDatabaseUrl(url)) {
  console.error(localDatabaseUrlRefusal(url, 'db:reset'))
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
await sql.unsafe(
  'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
)
await sql.end()
console.log('db:reset: public + drizzle schemas dropped and recreated (run db:migrate next)')
