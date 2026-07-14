import { pgTable, text, jsonb, primaryKey } from 'drizzle-orm/pg-core'
import { updatedAt } from './columns'

/**
 * Generic non-secret key/value store, now SCOPED PER USER (spec BYOK §1.1). The
 * AI config lives under the `'ai'` key as a typed JSON blob (see
 * `ai-config.service.ts`); the demo cache marker lives under `'demo'`. NEVER
 * holds a secret — provider keys live in the dedicated `ai_credential` table so a
 * `SELECT *` here can never leak one.
 *
 * The primary key is composite `(user_id, key)`: every user owns an independent
 * config namespace. `user_id` carries no FK (Supabase owns the auth table) —
 * scoping is enforced application-side like every other table.
 *
 * No check() on `key` on purpose: it is an open k/v namespace, so constraining
 * it would work against its intent (unlike the enum-like columns elsewhere).
 */
export const appSettings = pgTable(
  'app_settings',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)
