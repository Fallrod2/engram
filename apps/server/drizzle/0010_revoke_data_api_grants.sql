-- Data API lockdown: strip the stock Supabase grants of `anon` and
-- `authenticated` on schema `public`, present AND future.
-- HAND-WRITTEN (house pattern 0004/0006/0007/0008/0009): drizzle-kit never emits
-- privilege DDL, and there is NO 0010 snapshot (0007+ have none) — do NOT
-- `drizzle-kit generate` over this.
--
-- WHY. A Supabase project ships `GRANT ALL ON ALL TABLES IN SCHEMA public TO
-- anon, authenticated` (arwdDxtm = SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER) and repeats it on every FUTURE table through
-- `ALTER DEFAULT PRIVILEGES`. The `anon` key is public by construction — it is
-- built into the web bundle — so PostgREST (`/rest/v1/*`) is a second, unwanted
-- front door onto the same rows, one that the Hono API's `requireUserId`
-- scoping does not stand in front of. Today the ONLY thing between that key and
-- the data is RLS, and RLS is a single forgotten `CREATE TABLE` away from not
-- being there. Nothing in this project needs the Data API: `apps/web` uses
-- Supabase for AUTHENTICATION ONLY (no `.from(`, `.rpc(`, `.channel(`,
-- `.storage` anywhere), all data goes through `/api/*`, and the server connects
-- as the schema owner, which is unaffected by the revocations below. So the
-- surface is not defended, it is REMOVED — RLS stays as the second layer.
--
-- `service_role` is deliberately UNTOUCHED. Its key is a secret, it is deployed
-- nowhere in this project (no code path reads it), and the Supabase tooling —
-- dashboard table editor, pg_meta, backups — reaches the data through it.
-- Revoking it would break the console without closing a single public door.
--
-- `USAGE ON SCHEMA public` is deliberately KEPT (see docs/deploy-vercel.md,
-- § « API données (PostgREST) »): `public` grants USAGE to the pseudo-role
-- PUBLIC (`=U/pg_database_owner` on the cloud project), so revoking it from
-- `anon` alone changes strictly nothing, and revoking it from PUBLIC would hit
-- every role of the cluster (storage/realtime admins, pgbouncer, dashboard_user,
-- extension code resolving through search_path) for no marginal gain: USAGE
-- without a single object privilege opens access to nothing.
--
-- PORTABILITY — this is what dictates the shape below. The same file runs on
-- PGlite (`bun run test:db`) and on the bare Postgres of the e2e harness
-- (`e2e/support/db.ts` creates a throwaway database), where `anon` and
-- `authenticated` DO NOT EXIST: a plain `REVOKE ... FROM anon` would abort with
-- 42704 (role does not exist) and take the whole suite down with it. Every
-- statement is therefore guarded on `pg_roles` and expressed through EXECUTE.
-- Re-running the file is a no-op: REVOKE of an absent privilege succeeds.
DO $$
DECLARE
	grantee text;
	grantor text;
BEGIN
	FOREACH grantee IN ARRAY ARRAY['anon', 'authenticated'] LOOP
		-- The guard: on PGlite / bare Postgres these roles are simply absent.
		CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = grantee);

		-- Existing objects.
		EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', grantee);
		EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', grantee);
		EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', grantee);

		-- Future objects — the real trap. Without this block the next migration's
		-- CREATE TABLE silently re-grants everything and we are back to square one.
		-- Default privileges are keyed by GRANTOR, so clear them for every grantor
		-- that holds an entry on `public` AND that we are allowed to alter, plus our
		-- own role: it is the one that will create the tables of migration 0011, and
		-- it may not have an entry yet. `pg_has_role(..., 'USAGE')` is exactly the
		-- privilege ALTER DEFAULT PRIVILEGES FOR ROLE requires — on the cloud it
		-- skips the `supabase_admin` entry (the app role is not a member of it),
		-- which is fine: `supabase_admin` creates nothing in `public` for us.
		FOR grantor IN
			SELECT pg_get_userbyid(d.defaclrole)
			  FROM pg_default_acl d
			 WHERE d.defaclnamespace = 'public'::regnamespace
			   AND pg_has_role(current_user, d.defaclrole, 'USAGE')
			UNION
			SELECT current_user
		LOOP
			EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I', grantor, grantee);
			EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', grantor, grantee);
			EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', grantor, grantee);
		END LOOP;
	END LOOP;
END
$$;
