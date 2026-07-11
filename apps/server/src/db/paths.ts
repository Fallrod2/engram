import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Absolute path to the SQLite file (repo-root `data/engram.db`), overridable
 * via `ENGRAM_DB_PATH` (used by tests and tooling). Pure: no `bun:sqlite`
 * import, so it can be shared by `drizzle.config.ts` and the runtime client.
 */
export function resolveDbFilePath(): string {
  const override = process.env.ENGRAM_DB_PATH
  if (override) return override
  // This file lives at apps/server/src/db/ → 4 hops up to the repo root.
  return fileURLToPath(new URL('../../../../data/engram.db', import.meta.url))
}

/** Ensure the directory holding the SQLite file exists. */
export function ensureDataDir(): void {
  mkdirSync(dirname(resolveDbFilePath()), { recursive: true })
}
