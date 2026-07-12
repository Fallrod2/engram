import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { db, sql } from './client'

/**
 * Applies pending migrations via the postgres-js migrator, then closes the
 * connection (otherwise the process would hang on the open socket).
 */
await migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
})
console.log('drizzle: migrations applied')
await sql.end()
