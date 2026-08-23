-- Phase 8 — app_worker grants for the scheduled Subscription expiry check
-- (packages/database/src/worker/subscription-expiry.ts), mirroring the
-- EXACT pattern 0032 already established for outbox_events: discovering
-- which workspaces have an expirable subscription is inherently cross-
-- tenant (the worker doesn't know which workspace to scope to until it
-- has already found the row), so a second PERMISSIVE policy scoped
-- `TO app_worker` grants it unrestricted SELECT on `subscriptions` — the
-- general `subscriptions_tenant_isolation` policy (0037, no `TO` clause)
-- still governs every other role, including `app_runtime`, unchanged.
--
-- Once a candidate row is found, the actual UPDATE/INSERT work
-- (`updateSubscriptionStateTransaction`) runs INSIDE
-- `withWorkerRuntimeContext({workspaceId: <that row's own workspace>})`,
-- so the general tenant-isolation `WITH CHECK` correctly still applies to
-- every WRITE — only the discovery SELECT is broadened.
--> statement-breakpoint
CREATE POLICY "subscriptions_worker_scan_access" ON "subscriptions"
  FOR SELECT
  TO app_worker
  USING (true);
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.subscriptions TO app_worker;
--> statement-breakpoint
-- Entitlements recompute on every transition — same append-only shape as
-- app_runtime's own grant (0037), no UPDATE ever needed.
GRANT SELECT, INSERT ON public.entitlements TO app_worker;
--> statement-breakpoint
-- AuditEvent for the scheduled transition — `app_worker` did not
-- previously have this grant (0032 only covers what Phase 7's rule engine
-- needed); the subscription state machine is the first `app_worker`
-- write path that also needs to audit.
GRANT SELECT, INSERT ON public.audit_events TO app_worker;
