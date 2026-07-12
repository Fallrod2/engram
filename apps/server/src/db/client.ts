import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'
import { resolveDatabaseUrl } from './paths'

const url = resolveDatabaseUrl()
// The Supabase transaction pooler (:6543) does not support prepared statements.
const usesPooler = url.includes(':6543')
const sql = postgres(url, { prepare: !usesPooler })

export const db = drizzle(sql, { schema })
export type DB = typeof db

/**
 * The transaction handle passed to `db.transaction((tx) => …)`. Structurally it
 * shares the query-builder surface with `DB` but omits members like `$client`,
 * so functions that must accept both take a `db` and a `tx` against `DB | Tx`.
 */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0]

/** The raw postgres-js handle. Exported so migrate/reset scripts can close it. */
export { sql }
