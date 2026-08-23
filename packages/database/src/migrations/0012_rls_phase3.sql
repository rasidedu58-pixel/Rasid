-- Phase 3 — Row Level Security + least-privilege runtime grants for the 7
-- new tables (locations, operating_months, groups, group_months,
-- schedule_rules, sessions, idempotency_records). Hand-written (RLS/GRANT
-- DDL is not expressible via drizzle-kit generate), following the EXACT
-- same ADR-017 tenant-isolation pattern as 0005/0006/0007 — this migration
-- is written directly against the CORRECTED, NULLIF-guarded pattern from
-- 0007 (`NULLIF(current_setting('app.workspace_id', true), '')::uuid`), so
-- there is no separate "fix" migration needed for these tables the way
-- 0007 was needed retroactively for 0005's tables.
--
-- All policies apply to ALL commands (no `FOR SELECT` restriction) with
-- matching `USING`/`WITH CHECK`, since INSERT/UPDATE (never DELETE — see
-- the GRANT list below) must also be tenant-scoped for these tables.
--
-- `schedule_rules`, `sessions`, and `idempotency_records` denormalize
-- `workspace_id` directly (same pattern as `permission_grants` in Phase 2)
-- so their tenant-isolation policy is a direct column comparison, not a
-- join through a parent table.
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "operating_months" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "group_months" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "schedule_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "locations_tenant_isolation" ON "locations"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "operating_months_tenant_isolation" ON "operating_months"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "groups_tenant_isolation" ON "groups"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "group_months_tenant_isolation" ON "group_months"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "schedule_rules_tenant_isolation" ON "schedule_rules"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "sessions_tenant_isolation" ON "sessions"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "idempotency_records_tenant_isolation" ON "idempotency_records"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Least-privilege grants to app_runtime — SELECT, INSERT, UPDATE only,
-- NEVER DELETE (no operational row in this phase is ever hard-deleted;
-- cancel/reschedule/archive are status transitions).
GRANT SELECT, INSERT, UPDATE ON public.locations TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.operating_months TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.groups TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.group_months TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.schedule_rules TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.sessions TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.idempotency_records TO app_runtime;
--> statement-breakpoint
-- Defense-in-depth belt-and-suspenders: 0006's `ALTER DEFAULT PRIVILEGES`
-- already prevents new tables from getting anon/authenticated grants by
-- default, so these REVOKEs are confirmations, not strictly required —
-- included anyway for consistency/auditability with 0006's per-table style.
REVOKE ALL ON public.locations FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.locations FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.operating_months FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.operating_months FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.groups FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.groups FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.group_months FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.group_months FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.schedule_rules FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.schedule_rules FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.sessions FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.sessions FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.idempotency_records FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.idempotency_records FROM authenticated;
