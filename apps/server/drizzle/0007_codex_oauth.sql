-- Provider openai-codex (ChatGPT subscription OAuth). Two additive, backward-safe
-- changes (pattern 0003 for the CHECK widening + nullable columns like 0006):
--
-- 1. Add the OAuth state columns to `ai_credential` (NULLABLE → the 4 existing
--    key-based providers keep them NULL; no backfill, cannot fail on live rows).
-- 2. Widen BOTH provider CHECKs to also accept 'openai-codex' (drop + add; a pure
--    widening can never reject the existing anthropic/openrouter/ollama/…/mistral
--    rows). `generation_provider_ck` keeps its `is null` arm.
--
-- Hand-written (like 0006): the runtime PGlite migrator replays journal + SQL.

-- ai_credential: OAuth state columns (nullable) --------------------------------
ALTER TABLE "ai_credential" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "ai_credential" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_credential" ADD COLUMN "account_id" text;--> statement-breakpoint

-- Widen the provider CHECK constraints (drop + add) ----------------------------
ALTER TABLE "ai_credential" DROP CONSTRAINT "ai_credential_provider_ck";--> statement-breakpoint
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_provider_ck" CHECK ("ai_credential"."provider" in ('anthropic','openrouter','openai-compat','mistral','openai-codex'));--> statement-breakpoint
ALTER TABLE "generation" DROP CONSTRAINT "generation_provider_ck";--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_provider_ck" CHECK ("generation"."provider" is null or "generation"."provider" in ('anthropic','openrouter','ollama','openai-compat','mistral','openai-codex'));
