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

/**
 * Owner of the row (multi-tenant). Holds the `sub` claim of the Supabase JWT
 * (a uuid in prod, a plain string in dev/test). Deliberately NOT a physical FK
 * to `auth.users`: the PGlite database used in tests has no Supabase `auth`
 * schema. Isolation is enforced in the application layer (every query is scoped)
 * with RLS as documented defence-in-depth (see migration 0004).
 */
export const userId = () => text('user_id').notNull()

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
