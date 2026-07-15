import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core'
import { id, createdAt } from './columns'

/**
 * Append-only audit journal (spec §1.2): one row per admin WRITE (role change,
 * status change, demo flag, delete). Never updated or deleted — it survives a
 * user's GDPR deletion (legitimate interest), which is exactly why `details`
 * must hold NO PII (amendment A13): ids + counts + state values only. Emails are
 * resolved by JOIN at read time, never persisted here.
 */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: id(),
    actorUserId: text('actor_user_id').notNull(),
    action: text('action').notNull(),
    targetUserId: text('target_user_id'), // nullable (some actions are self-scoped)
    details: jsonb('details')
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_audit_created_idx').on(t.createdAt.desc()),
    index('admin_audit_target_idx').on(t.targetUserId),
  ],
)
