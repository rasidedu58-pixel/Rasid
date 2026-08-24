-- Phase 12 — Rasid Platform Admin. See schema/platform-admin.ts's own
-- module comment for the full rationale; this migration is the DDL half
-- of that design.
--
-- `platform_admins`: a small, NOT-tenant-scoped allowlist table, exactly
-- mirroring `owner_trial_grants` (0037) — NO RLS policy (RLS is a tenant-
-- isolation mechanism; this table isn't tenant data). Access is gated
-- purely by GRANT: only `app_runtime` gets SELECT (for the guard's own
-- membership check), no INSERT/UPDATE/DELETE grant exists for ANY
-- application role — granting/revoking platform-admin status is a
-- deliberate, out-of-band DBA operation only, same convention as the
-- `app_runtime`/`app_worker` role passwords (never committed, never
-- reachable from any endpoint).
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
GRANT SELECT ON public.platform_admins TO app_runtime;
--> statement-breakpoint
-- `platform_audit_events`: append-only audit trail for platform-admin
-- mutations. No RLS (not tenant data, same rationale as above); GRANT is
-- the only gate, scoped to the new `app_platform_admin` role exclusively
-- (below) — no other role, including `app_runtime`, can read or write it.
CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"target_workspace_id" uuid,
	"before_json" jsonb,
	"after_json" jsonb,
	"reason" text,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Dedicated least-privilege Postgres role for the platform-admin
-- connection, mirroring `app_worker`'s own provisioning (0032) exactly:
-- NOLOGIN by default (a one-time, out-of-band `ALTER ROLE
-- app_platform_admin WITH LOGIN PASSWORD '<secret>'` enables it per
-- environment, password never committed), NOSUPERUSER NOCREATEDB
-- NOCREATEROLE NOBYPASSRLS NOREPLICATION. Deliberately NOT a BYPASSRLS
-- role — no such role/pattern exists anywhere in this codebase, and the
-- narrowest-possible-widening precedent (0032/0038: additional PERMISSIVE
-- `USING (true)` policies scoped `TO` the new role, table by table) is
-- followed here instead, exactly as for `app_worker`'s own cross-tenant
-- outbox/subscription scans.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_platform_admin') THEN
    CREATE ROLE app_platform_admin NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 5;
  END IF;
END
$$;
--> statement-breakpoint
GRANT CONNECT ON DATABASE postgres TO app_platform_admin;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_platform_admin;
--> statement-breakpoint
-- Cross-tenant, READ-ONLY additional permissive policies — the general
-- tenant-isolation policy on each table (no `TO` clause) still applies to
-- every other role unchanged; Postgres ORs permissive policies together,
-- so the net effect for `app_platform_admin` specifically is unrestricted
-- SELECT, exactly the 0032/0038 pattern. No UPDATE/INSERT/DELETE policy on
-- any of these 5 tables — Phase 12 ships a READ-ONLY platform admin;
-- mutating actions (e.g. workspace suspension) are a deliberately deferred
-- follow-up (see the Phase 12 closure report's Known Limitations).
CREATE POLICY "workspaces_platform_admin_read" ON "workspaces"
  FOR SELECT
  TO app_platform_admin
  USING (true);
--> statement-breakpoint
CREATE POLICY "users_platform_admin_read" ON "users"
  FOR SELECT
  TO app_platform_admin
  USING (true);
--> statement-breakpoint
CREATE POLICY "memberships_platform_admin_read" ON "memberships"
  FOR SELECT
  TO app_platform_admin
  USING (true);
--> statement-breakpoint
CREATE POLICY "subscriptions_platform_admin_read" ON "subscriptions"
  FOR SELECT
  TO app_platform_admin
  USING (true);
--> statement-breakpoint
CREATE POLICY "entitlements_platform_admin_read" ON "entitlements"
  FOR SELECT
  TO app_platform_admin
  USING (true);
--> statement-breakpoint
GRANT SELECT ON public.workspaces TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.users TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.memberships TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.subscriptions TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.entitlements TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.platform_audit_events TO app_platform_admin;
