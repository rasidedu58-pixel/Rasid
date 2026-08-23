-- RLS Security Delta — least-privilege runtime role, Technical Architecture
-- §6 and Database Schema §16 follow-up to 0005_rls_policies. Hand-written
-- (role/grant/policy DDL is not expressible in the Drizzle TS schema DSL
-- used for drizzle-kit generate/diff), following the same ADR-017
-- tenant-isolation strategy as 0005.
--
-- WHY THIS MIGRATION EXISTS: 0005 turned on `ENABLE ROW LEVEL SECURITY` and
-- added tenant-isolation policies, but the application was (until this
-- delta) connecting to Postgres as the `postgres` role — the table owner,
-- which has BYPASSRLS. RLS policies are inert for any role with BYPASSRLS
-- or that is the table owner: they never filter anything for that role.
-- This migration provisions a dedicated, non-owner, NOBYPASSRLS role
-- (`app_runtime`) with least-privilege grants, so RLS is actually enforced
-- for the connection that serves real HTTP requests. The `postgres` role
-- remains in use ONLY for migrations/admin tooling (see
-- packages/database/src/migrate.ts and MIGRATION_DATABASE_URL) — it keeps
-- BYPASSRLS/table ownership, which is fine and expected for that path.
--
-- IMPORTANT: no password is set here and none is committed to source
-- control. `CREATE ROLE ... NOLOGIN` provisions the role without any
-- credential; a one-time, out-of-band `ALTER ROLE app_runtime WITH LOGIN
-- PASSWORD '<secret>';` (documented in packages/database/README, value
-- stored only in the deployment's secret store / local .env, never in git)
-- enables it per environment. This migration is safe to run repeatedly
-- (idempotent role creation) and on fresh environments alike.
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 20;
  END IF;
END
$$;
--> statement-breakpoint
GRANT CONNECT ON DATABASE postgres TO app_runtime;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint
-- Least-privilege, table-by-table grants. No DELETE anywhere: the
-- application never hard-deletes any of these rows — soft-revoke only
-- (`revoked_at` / `status` / `disabled_at`). `permission_group_scopes` and
-- `audit_events` deliberately omit UPDATE too: group-scope rows are never
-- updated (only inserted alongside their parent grant), and audit_events is
-- append-only per DB Schema §11.1.
GRANT SELECT, INSERT, UPDATE ON public.users TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.workspaces TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.memberships TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.permission_grants TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.permission_group_scopes TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.audit_events TO app_runtime;
--> statement-breakpoint
-- Residual-risk fix: Supabase's default project setup grants full
-- privileges (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) to
-- the `anon` and `authenticated` roles on every table created by `postgres`
-- in schema `public` (via pg_default_acl). RLS does not gate TRUNCATE, so
-- this was a real residual risk independent of the BYPASSRLS issue above.
-- Revoke everything from both roles on all 6 operational tables, and change
-- the default so this does not silently recur for tables Phase 3+ creates.
REVOKE ALL ON public.users FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.users FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.workspaces FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.workspaces FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.memberships FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.memberships FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.permission_grants FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.permission_grants FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.permission_group_scopes FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.permission_group_scopes FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.audit_events FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.audit_events FROM authenticated;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
--> statement-breakpoint
-- Supplementary, ADDITIONAL permissive RLS policies (Postgres OR-combines
-- multiple permissive policies for the same command) alongside the
-- existing workspace_id-scoped policies from 0005 — these do NOT replace
-- them. Purpose: `GET /me` legitimately needs to read a user's OWN
-- membership/workspace rows across potentially multiple workspaces at
-- once, which a single-workspace_id-scoped policy cannot satisfy. Only
-- ever exposes the CALLER's own identity-linked rows — this is correct
-- self-access, not a tenant leak (a user reading their own membership rows
-- and the workspaces those belong to).
CREATE POLICY "memberships_self_read" ON "memberships"
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY "workspaces_self_membership_read" ON "workspaces"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.workspace_id = workspaces.id
        AND m.user_id = current_setting('app.user_id', true)::uuid
    )
  );
