-- Phase 9 — app_worker grants for the notifications-scan job
-- (packages/database/src/worker/notifications-scan.ts). Mirrors the EXACT
-- pattern 0038 established for `subscriptions`: discovering which
-- workspaces have a candidate (an expiring subscription, a due follow-up, a
-- session with missing records) is inherently cross-tenant, so a second
-- PERMISSIVE, `TO app_worker`-scoped SELECT policy is added for the two
-- tables that need broad discovery scans. Once a candidate row is found
-- (with its own workspace_id), the actual notification write happens
-- inside `withWorkerRuntimeContext({workspaceId: <that row's workspace>})`
-- — at that point the general tenant-isolation policies already in force
-- on `workspaces`/`memberships`/`students` (no `TO` clause, so they already
-- apply to every non-bypass role) correctly scope any lookup needed to
-- resolve a recipient/student name, PROVIDED app_worker also holds the
-- base table-level SELECT grant — which is what this migration adds for
-- those three read-only lookups.
--> statement-breakpoint
CREATE POLICY "scheduled_followups_worker_scan_access" ON "scheduled_followups"
  FOR SELECT
  TO app_worker
  USING (true);
--> statement-breakpoint
GRANT SELECT ON public.scheduled_followups TO app_worker;
--> statement-breakpoint
CREATE POLICY "sessions_worker_scan_access" ON "sessions"
  FOR SELECT
  TO app_worker
  USING (true);
--> statement-breakpoint
-- (sessions already had a plain SELECT grant since 0032 — the broad POLICY
-- above is the only missing piece; re-issuing GRANT SELECT is harmless and
-- kept here for this migration's own completeness/readability.)
GRANT SELECT ON public.sessions TO app_worker;
--> statement-breakpoint
-- Read-only lookups needed to resolve a notification's recipient/context,
-- exercised ONLY after workspace context is already set (see comment
-- above) — never a broad/global scan target themselves.
GRANT SELECT ON public.workspaces TO app_worker;
--> statement-breakpoint
GRANT SELECT ON public.memberships TO app_worker;
--> statement-breakpoint
GRANT SELECT ON public.students TO app_worker;
