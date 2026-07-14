-- BYOK: config IA per-user (spec BYOK §1.1). Scopes `app_settings` and
-- `ai_credential` by adding a `user_id` owner and switching each table's primary
-- key from the single natural key to a composite `(user_id, key/provider)`.
--
-- drizzle-kit would emit `ADD COLUMN "user_id" text NOT NULL` (which FAILS on a
-- non-empty prod table) plus a bare DROP/ADD PRIMARY KEY. This file is
-- HAND-EDITED to the safe pattern of 0004 — ADD nullable → backfill → SET NOT
-- NULL → swap PK — so it applies cleanly on Alex's existing rows. The backfill
-- target is Alex's Supabase UID (public identifier, admin), so his single-user
-- config becomes the admin config after 0006. The meta snapshot reflects the
-- final composite-PK state, so do NOT regenerate this migration.
--
-- The `app_settings['demo']` row is an EPHEMERAL cache marker (last-seeded demo
-- session), not real user data: we DELETE it (cost: one demo reseed on the next
-- demo login) rather than guess an owner — at runtime it lives under
-- (demoUserId,'demo'). Everything below is standard SQL and passes on PGlite.

-- app_settings --------------------------------------------------------------
ALTER TABLE "app_settings" ADD COLUMN "user_id" text;--> statement-breakpoint
DELETE FROM "app_settings" WHERE "key" = 'demo';--> statement-breakpoint
UPDATE "app_settings" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" DROP CONSTRAINT "app_settings_pkey";--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_key_pk" PRIMARY KEY("user_id","key");--> statement-breakpoint

-- ai_credential -------------------------------------------------------------
ALTER TABLE "ai_credential" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "ai_credential" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "ai_credential" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_credential" DROP CONSTRAINT "ai_credential_pkey";--> statement-breakpoint
ALTER TABLE "ai_credential" ADD CONSTRAINT "ai_credential_user_id_provider_pk" PRIMARY KEY("user_id","provider");--> statement-breakpoint

-- Row-level security (defence-in-depth, mirrors 0004; application scoping is the
-- real gate — the schema-owner app role bypasses RLS, so these are dormant).
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "app_settings_user_isolation" ON "app_settings" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "ai_credential" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ai_credential_user_isolation" ON "ai_credential" USING ("user_id" = current_setting('app.user_id', true));
