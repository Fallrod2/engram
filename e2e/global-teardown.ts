import { dropRunDb } from './support/db'

/**
 * Drops the throwaway run database (Phase 7 §1.4). Runs in the same process as
 * the config module, so it reads the database name the config stashed in
 * `process.env` when it created the database.
 */
export default async function globalTeardown(): Promise<void> {
  await dropRunDb()
}
