import { sql } from 'drizzle-orm'
import { pgTable, text, check, primaryKey, timestamp } from 'drizzle-orm/pg-core'
import { createdAt, updatedAt } from './columns'

/**
 * A provider API key, one row per (user, provider) — WRITE-ONLY by construction.
 * SCOPED PER USER (spec BYOK §1.1): each user brings their own key (BYOK), so the
 * primary key is composite `(user_id, provider)`. The secret lives here and
 * NOWHERE else: no DTO reads it, the status surface derives "configured" from row
 * existence (`SELECT provider`, never `secret`). Only the internal resolver + the
 * set/delete/test ops read `secret`. `ollama` never has a row (no key), which the
 * check constraint also enforces. `user_id` carries no FK (Supabase owns auth).
 *
 * OAuth providers (openai-codex, migration 0007): `secret` holds the CURRENT
 * ACCESS token, and the nullable `refresh_token` / `expires_at` / `account_id`
 * columns carry the rest of the OAuth state. Key-based providers leave those
 * three NULL. The tokens stay write-only exactly like a key: no DTO reads them.
 */
export const aiCredential = pgTable(
  'ai_credential',
  {
    userId: text('user_id').notNull(),
    provider: text('provider').notNull(), // key-based providers + 'openai-codex' (OAuth)
    secret: text('secret').notNull(), // API key OR current OAuth access token
    /** OAuth refresh token (openai-codex only); NULL for key-based providers. */
    refreshToken: text('refresh_token'),
    /** OAuth access-token expiry (openai-codex only); drives the refresh margin. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** `chatgpt_account_id` claim → required `chatgpt-account-id` backend header. */
    accountId: text('account_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.provider] }),
    // Aligned with the codebase convention (generation.kind/status have checks):
    // key-bearing providers + the OAuth openai-codex; ollama stays excluded.
    check(
      'ai_credential_provider_ck',
      sql`${t.provider} in ('anthropic','openrouter','openai-compat','mistral','openai-codex')`,
    ),
  ],
)
