import { sql } from 'drizzle-orm'
import { pgTable, text, check, primaryKey } from 'drizzle-orm/pg-core'
import { createdAt, updatedAt } from './columns'

/**
 * A provider API key, one row per (user, provider) — WRITE-ONLY by construction.
 * SCOPED PER USER (spec BYOK §1.1): each user brings their own key (BYOK), so the
 * primary key is composite `(user_id, provider)`. The secret lives here and
 * NOWHERE else: no DTO reads it, the status surface derives "configured" from row
 * existence (`SELECT provider`, never `secret`). Only the internal resolver + the
 * set/delete/test ops read `secret`. `ollama` never has a row (no key), which the
 * check constraint also enforces. `user_id` carries no FK (Supabase owns auth).
 */
export const aiCredential = pgTable(
  'ai_credential',
  {
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(), // 'anthropic' | 'openrouter' | 'openai-compat' | 'mistral'
    secret: text('secret').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.provider] }),
    // Aligned with the codebase convention (generation.kind/status have checks):
    // only the key-bearing providers; ollama is excluded (no key stored).
    check(
      'ai_credential_provider_ck',
      sql`${t.provider} in ('anthropic','openrouter','openai-compat','mistral')`,
    ),
  ],
)
