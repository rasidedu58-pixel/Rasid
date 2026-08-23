-- Phase 4 — Row Level Security + least-privilege runtime grants for the 5
-- new tables (students, guardians, student_guardians, qr_credentials,
-- enrollments). Hand-written (RLS/GRANT DDL is not expressible via
-- drizzle-kit generate), following the EXACT same ADR-017 tenant-isolation
-- pattern as 0012 — written directly against the corrected, NULLIF-guarded
-- pattern from 0007 (`NULLIF(current_setting('app.workspace_id', true),
-- '')::uuid`), so there is no separate "fix" migration needed here the way
-- 0007 was needed retroactively for 0005's tables.
--
-- All policies apply to ALL commands (no `FOR SELECT` restriction) with
-- matching `USING`/`WITH CHECK`, since INSERT/UPDATE (never DELETE — see the
-- GRANT list below) must also be tenant-scoped for these tables.
--
-- `student_guardians`, `qr_credentials`, and `enrollments` denormalize
-- `workspace_id` directly (same pattern as `sessions`/`schedule_rules` in
-- Phase 3) so their tenant-isolation policy is a direct column comparison,
-- not a join through a parent table.
--> statement-breakpoint
ALTER TABLE "students" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "guardians" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "student_guardians" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "qr_credentials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "enrollments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "students_tenant_isolation" ON "students"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "guardians_tenant_isolation" ON "guardians"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "student_guardians_tenant_isolation" ON "student_guardians"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "qr_credentials_tenant_isolation" ON "qr_credentials"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "enrollments_tenant_isolation" ON "enrollments"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Least-privilege grants to app_runtime — SELECT, INSERT, UPDATE only,
-- NEVER DELETE (no operational row in this phase is ever hard-deleted;
-- archive/withdraw/revoke are status transitions).
GRANT SELECT, INSERT, UPDATE ON public.students TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.guardians TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.student_guardians TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.qr_credentials TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.enrollments TO app_runtime;
--> statement-breakpoint
-- Defense-in-depth belt-and-suspenders: 0006's `ALTER DEFAULT PRIVILEGES`
-- already prevents new tables from getting anon/authenticated grants by
-- default, so these REVOKEs are confirmations, not strictly required —
-- included anyway for consistency/auditability with 0006/0012's style.
REVOKE ALL ON public.students FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.students FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.guardians FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.guardians FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.student_guardians FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.student_guardians FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.qr_credentials FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.qr_credentials FROM authenticated;
--> statement-breakpoint
REVOKE ALL ON public.enrollments FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.enrollments FROM authenticated;
