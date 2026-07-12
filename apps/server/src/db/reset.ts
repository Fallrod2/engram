import postgres from 'postgres'
import { resolveDatabaseUrl } from './paths'

/**
 * Destructive LOCAL reset. Drops and recreates the `public` schema plus the
 * drizzle bookkeeping schema so a regenerated baseline migration re-applies
 * from scratch (a regenerated `0000_*.sql` otherwise collides with the tables
 * an earlier baseline already created → `42P07 relation already exists`).
 *
 * Guard rail: refuses to run unless `DATABASE_URL` points at the local Supabase
 * database (`127.0.0.1`/`localhost` on the default DB port `54322`). This can
 * never fire against the cloud, even by accident. Chained with `db:migrate` by
 * the `db:reset` script.
 */
const url = resolveDatabaseUrl()
const { hostname, port } = new URL(url)
const isLocal = (hostname === '127.0.0.1' || hostname === 'localhost') && port === '54322'
if (!isLocal) {
  console.error(
    `db:reset refused: DATABASE_URL must point at the local Supabase database ` +
      `(127.0.0.1/localhost:54322), got ${hostname}:${port || '(default)'}.`,
  )
  process.exit(1)
}

const sql = postgres(url, { max: 1 })
await sql.unsafe(
  'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
)
await sql.end()
console.log('db:reset: public + drizzle schemas dropped and recreated (run db:migrate next)')
