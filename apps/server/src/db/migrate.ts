import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { db } from './client'

/**
 * Applies pending migrations via the bun-sqlite migrator (drizzle-kit has no
 * bun:sqlite driver; it only generates SQL and runs studio).
 */
migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
})
console.log('drizzle: migrations applied')
