import { sql } from 'drizzle-orm'
import { pgTable, text, boolean, timestamp, index, check, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, updatedAt } from './columns'

/**
 * IAM profile, one row per authenticated user (spec §1.1). Created lazily by the
 * profile middleware on the first authenticated request and touched (throttled)
 * on every subsequent one. `user_id` is the JWT `sub` and carries NO physical FK
 * to `auth.users` — the PGlite test DB has no Supabase `auth` schema (columns.ts
 * documents the same deliberate choice for every user-owned table). Isolation +
 * role/status are enforced application-side.
 *
 * Two invariants are guaranteed IN THE DATABASE (amendment A7.3), not merely by
 * the application, so a concurrent pair of admin writes can never violate them:
 *   - `user_profile_demo_singleton`: at most ONE `is_demo = true` row;
 *   - `user_profile_not_demo_admin`: never `is_demo` AND `role = 'admin'`.
 */
export const userProfile = pgTable(
  'user_profile',
  {
    userId: text('user_id').primaryKey(),
    email: text('email'), // nullable: a token may carry no email claim
    role: text('role').notNull().default('user'),
    status: text('status').notNull().default('active'),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Throttled touch target; NOT NULL with a DEFAULT so the 0008 backfill and
    // the lazy upsert both satisfy it without an explicit value (amendment A7.1).
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index('user_profile_last_seen_idx').on(t.lastSeenAt),
    // Partial index over the handful of admin rows (role resolution + last-admin
    // guard scan a tiny set).
    index('user_profile_role_admin_idx')
      .on(t.role)
      .where(sql`${t.role} = 'admin'`),
    check('user_profile_role_ck', sql`${t.role} in ('admin','user')`),
    check('user_profile_status_ck', sql`${t.status} in ('active','suspended')`),
    // At most one demo account, enforced in DB (concurrency-safe unicity).
    uniqueIndex('user_profile_demo_singleton')
      .on(sql`(1)`)
      .where(sql`${t.isDemo}`),
    // A demo can never be an admin (blocks a promote-vs-demo-set race).
    check('user_profile_not_demo_admin', sql`not (${t.isDemo} and ${t.role} = 'admin')`),
  ],
)
