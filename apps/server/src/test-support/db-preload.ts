import { fileURLToPath } from 'node:url'
import { mock } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '../db/schema'

/**
 * bun:test preload for the route + app specs. Replaces the production client
 * (postgres-js → real Postgres) with a fresh in-process PGlite database BEFORE
 * any module imports the singleton `db`, via `mock.module`. Runs once per test
 * process, so every spec shares this one migrated database (cleaned between
 * tests by `resetDb`). Never touches the real DB and needs no daemon.
 */
const client = new PGlite()
const db = drizzle(client, { schema })
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })

mock.module('../db/client', () => ({ db, sql: client }))
