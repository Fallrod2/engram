-- Provenance of a generation's items (T-031). HAND-WRITTEN (house pattern
-- 0004/0006/0007/0008/0009/0010): there is NO 0011 snapshot — 0007+ have none —
-- so do NOT `drizzle-kit generate` over this file. Everything below is standard
-- SQL and applies on PGlite (`bun run test:db`) as well as on Postgres.
--
-- WHY A COLUMN AND NOT A CONVENTION. The demo account now ships a generation
-- whose cards were WRITTEN BY HAND, so a visitor with no API key can still do
-- the real card-by-card review. That staging has to be disclosed on screen, and
-- the disclosure is only trustworthy if the claim is stored: a heuristic
-- ("model looks odd", "user is the demo") would silently stop matching one day
-- and the banner would vanish from a staged result — the exact lie this feature
-- exists to avoid.
--
-- NO BACKFILL STATEMENT IS NEEDED. `DEFAULT 'live'` + `NOT NULL` fills every
-- existing row in the same ALTER, and 'live' is TRUE of all of them: before this
-- migration the only writer was `startGeneration`, which calls a provider. The
-- default also keeps the CHECK satisfiable for any future writer that forgets
-- the column — the staged rows are the ones that must opt in.
ALTER TABLE "generation" ADD COLUMN "origin" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_origin_ck" CHECK ("generation"."origin" in ('live','prerecorded'));
