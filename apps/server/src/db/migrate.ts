import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { resolveMigrationDatabaseUrl } from './paths'

/**
 * Applies pending migrations on a dedicated connection — preferring the direct
 * (non-pooled) URL when available — then closes it (otherwise the process
 * would hang on the open socket).
 */
const url = resolveMigrationDatabaseUrl()
const sql = postgres(url, { prepare: !url.includes(':6543'), max: 1 })

await migrate(drizzle(sql), {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
})
console.log('drizzle: migrations applied')
await sql.end()
