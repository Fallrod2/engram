-- Delegated administration: groups grant a TARGETED subset of the admin
-- permission set to non-admin users (rbac-groups §2). HAND-WRITTEN (house pattern
-- 0004/0006/0007/0008): there is NO 0009 snapshot (0007+ have none) — do NOT
-- `drizzle-kit generate` over this. Everything below is standard SQL and passes
-- on PGlite; it NEVER references the Supabase `auth` schema.
--
-- Backfill: NONE. No default group is created — the admin creates groups from the
-- console. Groups never touch `user_profile.role`, so the last-admin guard stays
-- protected independently of any group (amendment).
--
-- ⚠️ The `group_permission_valid` CHECK is the EXACT mirror of ADMIN_PERMISSIONS
-- (packages/shared/src/admin.ts). Adding a permission REQUIRES updating that
-- constant AND a NEW migration widening this CHECK (amendment D2). The PGlite
-- test `group-permission CHECK mirrors ADMIN_PERMISSIONS` guards the drift.

-- `user_group`, not the reserved keyword `group` (amendment D1) — no quoting trap.
CREATE TABLE "user_group" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_group_name_not_empty" CHECK (length(btrim("user_group"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_pk" PRIMARY KEY ("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_permission" (
	"group_id" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "group_permission_pk" PRIMARY KEY ("group_id","permission"),
	CONSTRAINT "group_permission_valid" CHECK ("group_permission"."permission" in ('users.view','users.manage','groups.manage','audit.view','stats.view'))
);
--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_permission" ADD CONSTRAINT "group_permission_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Case-insensitive unicity ("Mods" vs "mods") — the primary validation for a name.
CREATE UNIQUE INDEX "user_group_name_lower_uq" ON "user_group" USING btree (lower("name"));--> statement-breakpoint
-- Resolution scans membership by user_id (the permission subquery, amendment C1).
CREATE INDEX "group_member_user_idx" ON "group_member" USING btree ("user_id");--> statement-breakpoint

-- Row-level security (defence-in-depth; house pattern 0004/0006/0008). The app
-- role (schema owner) BYPASSES RLS, so real enforcement stays application-side —
-- these deny-all blocks document intent for a future restricted role.
ALTER TABLE "user_group" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "group_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "group_permission" ENABLE ROW LEVEL SECURITY;
