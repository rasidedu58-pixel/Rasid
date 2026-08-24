-- Phase 10 Closure Delta — app_worker needs SELECT on `notifications`.
--
-- The subscription-reminder catch-up rule (`determineMilestoneToEmit`,
-- `worker/notifications-scan.ts`) must know which dedup keys a given
-- subscription ALREADY has a notification row for, to decide whether the
-- single most-relevant crossed milestone still needs to be emitted this
-- scan. `app_worker` previously had INSERT-only access to `notifications`
-- (migration 0043) — sufficient for Phase 9's write-once dedup-via-INSERT
-- pattern, but not enough for this read-before-decide step.
--
-- Scope stays as narrow as the existing INSERT policy: `app_worker` may
-- read ONLY rows in the workspace it is currently scanning
-- (`withWorkerRuntimeContext({workspaceId})` — same `app.workspace_id`
-- check `notifications_worker_insert` already uses), never a bare
-- unscoped SELECT across every tenant, and never another user's
-- notification content beyond what it could already discover indirectly
-- via the dedup-unique-violation-on-INSERT signal it already had.
--> statement-breakpoint
CREATE POLICY "notifications_worker_select" ON "notifications"
  FOR SELECT
  TO app_worker
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT ON public.notifications TO app_worker;
