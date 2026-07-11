import { integer, text } from 'drizzle-orm/sqlite-core'

/**
 * Shared column builders. Kept in one place so every table uses identical
 * conventions: UUID text PKs and epoch-ms timestamps mapped to `Date`.
 */

/** Text primary key defaulting to a server-generated UUID v4. */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

/** `created_at` epoch-ms, set on insert. */
export const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())

/** `updated_at` epoch-ms, set on insert and bumped on every update. */
export const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
