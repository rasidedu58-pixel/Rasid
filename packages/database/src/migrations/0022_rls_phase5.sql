-- Phase 5 — Row Level Security + least-privilege runtime grants for the 2
-- new tables (session_exams, session_records). Same ADR-017 tenant-isolation
-- pattern as 0012/0019 — the corrected, NULLIF-guarded pattern from 0007
-- (`NULLIF(current_setting('app.workspace_id', true), '')::uuid`).
--
-- Both tables denormalize `workspace_id` directly (same pattern as
-- `sessions`/`enrollments`), so tenant isolation is a direct column
-- comparison, not a join.
--> statement-breakpoint
ALTER TABLE "session_exams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "session_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "session_exams_tenant_isolation" ON "session_exams"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "session_records_tenant_isolation" ON "session_records"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Least-privilege grants to app_runtime — SELECT, INSERT, UPDATE only, NEVER
-- DELETE (records are corrected via UPDATE, never hard-deleted; a completed
-- Session's records stay in history — Phase 5 requirement).
GRANT SELECT, INSERT, UPDATE ON public.session_exams TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.session_records TO app_runtime;
