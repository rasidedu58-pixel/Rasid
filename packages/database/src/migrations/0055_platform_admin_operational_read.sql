-- Phase C — Platform Console operational snapshot / support diagnostic.
--
-- Grants the READ-ONLY `app_platform_admin` role cross-tenant SELECT on the
-- operational tables it needs to answer "does this customer have a current
-- month? how many groups/students? any recent activity?" — mirroring exactly
-- the additive-permissive-policy pattern established in 0048 for the first 5
-- tables (workspaces/users/memberships/subscriptions/entitlements).
--
-- STILL READ-ONLY: only FOR SELECT, USING (true), plus GRANT SELECT. No
-- INSERT/UPDATE/DELETE policy or grant on any of these tables. The general
-- tenant-isolation policy (no TO clause) on each table is unchanged for every
-- other role; Postgres ORs permissive policies, so the net effect for
-- app_platform_admin alone is unrestricted SELECT.
--
-- Additive and reversible (each object is a new policy/grant; dropping them
-- restores the prior state). Deliberately NOT auto-applied to Production —
-- apply via the same safe preflight used for other platform migrations.

CREATE POLICY "groups_platform_admin_read" ON "groups"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "students_platform_admin_read" ON "students"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "group_months_platform_admin_read" ON "group_months"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "operating_months_platform_admin_read" ON "operating_months"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "sessions_platform_admin_read" ON "sessions"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "enrollments_platform_admin_read" ON "enrollments"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "audit_events_platform_admin_read" ON "audit_events"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
GRANT SELECT ON public.groups TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.students TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.group_months TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.operating_months TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.sessions TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.enrollments TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT ON public.audit_events TO app_platform_admin;
