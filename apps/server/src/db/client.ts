import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './schema'
import { resolveDbFilePath, ensureDataDir } from './paths'

ensureDataDir()
const sqlite = new Database(resolveDbFilePath(), { create: true })
sqlite.exec('PRAGMA journal_mode = WAL;')
sqlite.exec('PRAGMA foreign_keys = ON;') // REQUIRED for cascade / set-null
sqlite.exec('PRAGMA busy_timeout = 5000;')

export const db = drizzle(sqlite, { schema })
export type DB = typeof db

/**
 * The transaction handle passed to `db.transaction((tx) => …)`. Structurally it
 * shares the query-builder surface with `DB` but omits members like `$client`,
 * so functions that must accept both a `db` and a `tx` type against `DB | Tx`.
 */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]
