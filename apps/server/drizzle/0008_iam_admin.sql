-- IAM: role/status/demo profile + append-only admin audit journal (spec §1).
-- HAND-WRITTEN (house pattern 0004/0006/0007): the backfill, the DB-level
-- invariants, and the RLS blocks are not something drizzle-kit emits, and there
-- is NO 0008 snapshot (0007 already has none) — do NOT `drizzle-kit generate`
-- over this without first reconstructing the snapshots. Everything below is
-- standard SQL and passes on PGlite: it NEVER references the Supabase `auth`
-- schema (the test DB has none) — emails arrive later via the lazy upsert (§2).

CREATE TABLE "user_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text,
	"role" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_role_ck" CHECK ("user_profile"."role" in ('admin','user')),
	CONSTRAINT "user_profile_status_ck" CHECK ("user_profile"."status" in ('active','suspended')),
	CONSTRAINT "user_profile_not_demo_admin" CHECK (not ("user_profile"."is_demo" and "user_profile"."role" = 'admin'))
);
--> statement-breakpoint
CREATE TABLE "admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_user_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_profile_last_seen_idx" ON "user_profile" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "user_profile_role_admin_idx" ON "user_profile" USING btree ("role") WHERE "user_profile"."role" = 'admin';--> statement-breakpoint
-- At most ONE demo account, enforced in DB (concurrency-safe, amendment A7.3).
CREATE UNIQUE INDEX "user_profile_demo_singleton" ON "user_profile" USING btree ((1)) WHERE "user_profile"."is_demo";--> statement-breakpoint
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" USING btree ("created_at" DESC);--> statement-breakpoint
CREATE INDEX "admin_audit_target_idx" ON "admin_audit" USING btree ("target_user_id");--> statement-breakpoint

-- Backfill: every distinct EXISTING owner becomes a role='user' profile. UNION
-- (not UNION ALL) dedups; ON CONFLICT makes the migration idempotent (amendment
-- A7.2). deck/card/review_log are omitted on purpose: every owner of those also
-- owns a subject (wipeUserData's FK-safe order confirms the containment), so the
-- UNION below already covers them. created_at/last_seen_at take their now()
-- defaults (amendment A7.1 — last_seen_at is NOT NULL WITH a default).
INSERT INTO "user_profile" ("user_id")
SELECT "user_id" FROM "subject"
UNION SELECT "user_id" FROM "note"
UNION SELECT "user_id" FROM "exam"
UNION SELECT "user_id" FROM "generation"
UNION SELECT "user_id" FROM "app_settings"
UNION SELECT "user_id" FROM "ai_credential"
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint
-- Promote Alex (public Supabase UID, same identifier as 0004 — not a secret).
INSERT INTO "user_profile" ("user_id", "role")
VALUES ('20d58a6e-71c6-4af2-b1d4-143c93970f8b', 'admin')
ON CONFLICT ("user_id") DO UPDATE SET "role" = 'admin';--> statement-breakpoint

-- Row-level security (defence-in-depth; house pattern 0004:61-78 / 0006). The
-- application role (schema owner) BYPASSES RLS, so real enforcement stays
-- application-side — these policies document intent for a future restricted role.
-- user_profile: a user may read only their OWN row. admin_audit: RLS enabled with
-- NO policy = deny-all to any non-owner role (admin-only, read via the owner).
ALTER TABLE "user_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "user_profile_self_read" ON "user_profile" USING ("user_id" = current_setting('app.user_id', true));--> statement-breakpoint
ALTER TABLE "admin_audit" ENABLE ROW LEVEL SECURITY;
