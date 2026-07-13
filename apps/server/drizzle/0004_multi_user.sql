-- Multi-user foundations (spec §1). Adds a `user_id` owner to the 7 user tables.
--
-- drizzle-kit emits `ADD COLUMN "user_id" text NOT NULL`, which FAILS on a
-- non-empty table (dev/prod). This file is HAND-EDITED to the safe 3-step
-- pattern per table — ADD nullable → UPDATE backfill → ALTER SET NOT NULL —
-- so it applies cleanly on Alex's existing data. The backfill target is Alex's
-- Supabase UID (public identifier, not a secret). The meta snapshot reflects the
-- final NOT NULL state, so do NOT regenerate this migration.
--
-- RLS blocks (ENABLE + CREATE POLICY) are appended by hand: drizzle-kit does not
-- manage row-level security, so it will never drop them. This is documented
-- defence-in-depth for a future PostgREST / restricted role — the application
-- role (schema owner) bypasses RLS, so real enforcement stays application-side
-- (spec §2). Everything below is standard SQL and passes on PGlite.
DROP INDEX "card_due_idx";--> statement-breakpoint

-- subject -------------------------------------------------------------------
ALTER TABLE "subject" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "subject" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "subject" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- deck ----------------------------------------------------------------------
ALTER TABLE "deck" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "deck" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "deck" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- card ----------------------------------------------------------------------
ALTER TABLE "card" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "card" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "card" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- review_log ----------------------------------------------------------------
ALTER TABLE "review_log" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "review_log" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "review_log" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- note ----------------------------------------------------------------------
ALTER TABLE "note" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "note" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "note" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- generation ----------------------------------------------------------------
ALTER TABLE "generation" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "generation" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "generation" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- exam ----------------------------------------------------------------------
ALTER TABLE "exam" ADD COLUMN "user_id" text;--> statement-breakpoint
UPDATE "exam" SET "user_id" = '20d58a6e-71c6-4af2-b1d4-143c93970f8b' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "exam" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint

-- Indexes (composite, user-led scans) ---------------------------------------
CREATE INDEX "subject_user_idx" ON "subject" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deck_user_idx" ON "deck" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "card_user_due_idx" ON "card" USING btree ("user_id","due");--> statement-breakpoint
CREATE INDEX "review_log_user_review_idx" ON "review_log" USING btree ("user_id","review");--> statement-breakpoint
CREATE INDEX "note_user_idx" ON "note" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "generation_user_idx" ON "generation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "exam_user_date_idx" ON "exam" USING btree ("user_id","date");--> statement-breakpoint

-- Row-level security (defence-in-depth; application scoping is the real gate) -
ALTER TABLE "subject" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "subject_user_isolation" ON "subject" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "deck" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deck_user_isolation" ON "deck" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "card" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "card_user_isolation" ON "card" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "review_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "review_log_user_isolation" ON "review_log" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "note" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "note_user_isolation" ON "note" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "generation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "generation_user_isolation" ON "generation" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "exam" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exam_user_isolation" ON "exam" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
-- exam_subject has no user_id (junction); its policy derives ownership from exam.
ALTER TABLE "exam_subject" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "exam_subject_user_isolation" ON "exam_subject" USING (EXISTS (SELECT 1 FROM "exam" e WHERE e.id = "exam_id" AND e.user_id = current_setting('app.user_id', true)));
