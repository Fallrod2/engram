import { pgTable, text, jsonb } from 'drizzle-orm/pg-core'
import { updatedAt } from './columns'

/**
 * Generic non-secret key/value store (future-proof: OCR, integrations…). The AI
 * config lives under the `'ai'` key as a typed JSON blob (see
 * `ai-config.service.ts`). NEVER holds a secret — provider keys live in the
 * dedicated `ai_credential` table so a `SELECT *` here can never leak one.
 *
 * No check() on `key` on purpose: it is an open k/v namespace, so constraining
 * it would work against its intent (unlike the enum-like columns elsewhere).
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
})
