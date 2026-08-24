-- Phase 9 — RLS + least-privilege grants for `notifications`/`exports`.
--
-- `notifications` is the FIRST table needing per-USER isolation on top of
-- the usual per-workspace isolation — a caller must only ever see their
-- OWN notifications, not every notification in the workspace. Two
-- deliberate policies, exactly per the Phase 9 Closure correction:
--
-- 1. `notifications_owner_access` (no `TO` clause — governs `app_runtime`,
--    the ordinary authenticated-request role): USING/WITH CHECK requires
--    BOTH `workspace_id = app.workspace_id` AND `user_id = app.user_id` —
--    a user can read/close only rows addressed to them.
-- 2. `notifications_worker_insert` (`TO app_worker`, INSERT only): requires
--    ONLY `workspace_id = app.workspace_id` — the worker produces
--    notifications FOR arbitrary recipient users within the workspace it is
--    currently scanning (`withWorkerRuntimeContext({workspaceId})`), so it
--    can never satisfy a `user_id = app.user_id` check (it has no single
--    "current user" of its own). `app_worker` gets NO SELECT/UPDATE/DELETE
--    on this table at all — it only ever inserts (`ON CONFLICT DO NOTHING`
--    against the dedup unique constraint), never reads back, never marks
--    read, never deletes. `app_worker` remains NOBYPASSRLS (0032) — this is
--    enforced by RLS, not by trusting the application layer alone.
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notifications_owner_access" ON "notifications"
  USING (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint
CREATE POLICY "notifications_worker_insert" ON "notifications"
  FOR INSERT
  TO app_worker
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- `app_runtime`: SELECT (list own notifications) + column-restricted UPDATE
-- on `read_at` ONLY (mark read / read-all) — never free-form content
-- rewrite, never DELETE, never INSERT (never a system-notification
-- producer — that is `app_worker`'s job alone).
GRANT SELECT, UPDATE ("read_at") ON public.notifications TO app_runtime;
--> statement-breakpoint
-- `app_worker`: INSERT only — see policy comment above for why no other
-- privilege is granted.
GRANT INSERT ON public.notifications TO app_worker;
--> statement-breakpoint
-- `exports`: ordinary single-tenant isolation (like `subscriptions`) — no
-- per-user split needed (any active member with `reports.export` may list/
-- fetch an export metadata row created under their workspace; the actual
-- CSV bytes are re-derived and re-authorized fully independently at
-- download time, in the application layer, against the CALLER'S current
-- permission/entitlement/scope — see `reports.repository.ts`).
ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "exports_tenant_isolation" ON "exports"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- SELECT + INSERT only — no UPDATE/DELETE grant. A row is written once
-- (status is decided synchronously, in the SAME insert, in V1) and never
-- mutated afterward; expiry is enforced by comparing `expires_at` at read
-- time, not by deleting/updating the row.
GRANT SELECT, INSERT ON public.exports TO app_runtime;
