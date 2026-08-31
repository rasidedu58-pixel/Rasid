-- Platform Issues Center — worker/queue read access for the status aggregator.
--
-- Grants the READ-ONLY `app_platform_admin` role cross-tenant SELECT on
-- `outbox_events` so the "حالة المنصة والمشكلات" page can derive worker health,
-- the background-jobs snapshot, and recent operational problems from the queue.
-- Mirrors exactly the additive-permissive-policy pattern of 0055.
--
-- READ-ONLY: FOR SELECT + USING(true), plus GRANT SELECT. No INSERT/UPDATE/
-- DELETE. The existing `outbox_events_tenant_isolation` policy uses the null-
-- safe current_setting idiom, so with this additive permissive policy
-- app_platform_admin gets unrestricted SELECT and nothing else changes for any
-- other role.
--
-- Additive and reversible. NOT auto-applied to Production — apply via the same
-- safe preflight as the other platform migrations. Until applied, the page's
-- worker/jobs/recent-problems sections degrade to UNKNOWN (never a 500).

CREATE POLICY "outbox_events_platform_admin_read" ON "outbox_events"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
GRANT SELECT ON public.outbox_events TO app_platform_admin;
