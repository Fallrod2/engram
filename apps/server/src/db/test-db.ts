import { Database } from 'bun:sqlite'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as schema from './schema'

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

export type TestDb = {
  db: BunSQLiteDatabase<typeof schema>
  /** Close the connection and delete the temp directory. */
  cleanup: () => void
}

/**
 * Build a fresh migrated SQLite database in a temp dir, with the same PRAGMAs
 * as the runtime client (foreign_keys ON is required for cascades). Used by the
 * integration tests so they never touch `data/engram.db`.
 */
export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'engram-test-'))
  const sqlite = new Database(join(dir, 'test.db'), { create: true })
  sqlite.exec('PRAGMA journal_mode = WAL;')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  sqlite.exec('PRAGMA busy_timeout = 5000;')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  return {
    db,
    cleanup: () => {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
