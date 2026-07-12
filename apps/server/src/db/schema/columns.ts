import { text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Shared column builders. Kept in one place so every table uses identical
 * conventions: UUID text PKs and `timestamptz` timestamps mapped to `Date`.
 */

/** Text primary key defaulting to a server-generated UUID v4. */
export const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

/** `created_at` timestamptz, set on insert. Drizzle type stays `Date`. */
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date())

/** `updated_at` timestamptz, set on insert and bumped on every update. */
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date())
