import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from './schema'
import type { DB } from './client'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export type TestDb = {
  db: DB
  /** The raw PGlite instance — the anti-N+1 spy hooks `client.query`. */
  client: PGlite
  /** Close the in-process database. */
  cleanup: () => Promise<void>
}

/**
 * Build a fresh migrated in-process PGlite database (Postgres compiled to WASM,
 * zero daemon) so the integration specs never touch the real database. The
 * drizzle handle is cast to the production `DB` type so service signatures
 * accept it verbatim (the query-builder surface is identical across drivers).
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return {
    db: db as unknown as DB,
    client,
    cleanup: async () => {
      await client.close()
    },
  }
}
