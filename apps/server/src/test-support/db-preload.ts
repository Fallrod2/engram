import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

/**
 * bun:test preload for the route specs. Points `ENGRAM_DB_PATH` at a fresh temp
 * file BEFORE any module imports the singleton `db`, then migrates it. Runs once
 * per test process, so every route spec shares one migrated database (cleaned
 * between tests via `resetDb`). Never touches `data/engram.db`.
 */
const dir = mkdtempSync(join(tmpdir(), 'engram-routes-'))
process.env.ENGRAM_DB_PATH = join(dir, 'test.db')

const { db } = await import('../db/client')
migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
