import { sql } from 'drizzle-orm'
import { pgTable, text, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core'
import { ADMIN_PERMISSIONS } from '@engram/shared'
import { id, createdAt, updatedAt, userId } from './columns'

/**
 * Delegated-administration groups (rbac-groups §2). A group grants a TARGETED
 * subset of `ADMIN_PERMISSIONS` to its non-admin members — a moderator = a
 * `role='user'` in a group with permissions. Groups NEVER touch `role='admin'`,
 * so the last-admin guard is protected INDEPENDENTLY of any group (amendment).
 *
 * Named `user_group` (not the reserved SQL keyword `group`, amendment D1) —
 * consistent with `user_profile` and free of quoting traps. `group_member.user_id`
 * carries the JWT `sub` with NO physical FK (same deliberate choice as every
 * user-owned table, columns.ts) — a purge on `deleteUser` keeps it tidy (E1).
 */

/** A group. UNIQUE on `lower(name)` (case-insensitive, amendment F2) + non-empty. */
export const userGroup = pgTable(
  'user_group',
  {
    id: id(),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_group_name_lower_uq').on(sql`lower(${t.name})`),
    check('user_group_name_not_empty', sql`length(btrim(${t.name})) > 0`),
  ],
)

/**
 * Group membership. PK `(group_id, user_id)` (a user is in a group at most once),
 * `group_id` FK → `user_group.id` ON DELETE CASCADE, `user_id` a free-text `sub`
 * (no FK). Index on `user_id` — the permission resolution subquery scans by user.
 */
export const groupMember = pgTable(
  'group_member',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => userGroup.id, { onDelete: 'cascade' }),
    userId: userId(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index('group_member_user_idx').on(t.userId),
  ],
)

/**
 * The permissions a group grants. PK `(group_id, permission)`, `group_id` FK
 * CASCADE. The CHECK is the exact mirror of `ADMIN_PERMISSIONS` — a DB backstop
 * against a bad write (Zod is the primary validation, amendment D2). Built FROM
 * the constant so the schema definition can never silently drift from it.
 */
export const groupPermission = pgTable(
  'group_permission',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => userGroup.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.permission] }),
    check(
      'group_permission_valid',
      sql`${t.permission} in (${sql.join(
        ADMIN_PERMISSIONS.map((p) => sql`${p}`),
        sql`, `,
      )})`,
    ),
  ],
)
