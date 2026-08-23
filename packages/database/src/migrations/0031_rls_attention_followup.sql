-- Phase 7 — RLS + least-privilege `app_runtime` grants for the 5 new
-- tables. Same ADR-017 tenant-isolation pattern as every prior phase.
--
-- Grants here are `app_runtime`'s (apps/api, user-driven HTTP requests)
-- ONLY — deliberately NOT a mechanical SELECT/INSERT/UPDATE across the
-- board, and NOT symmetric with the separate `app_worker` role's own grants
-- (see 0032_app_worker_role.sql), because the two roles genuinely write
-- different things:
--   - attention_cases:   app_runtime only transitions status via user
--     endpoints (start-followup/mark-monitoring/close) → SELECT, UPDATE.
--     It never CREATES a case (only the rule engine does) → no INSERT.
--   - attention_reasons / attention_evidence: app_runtime only ever
--     DISPLAYS these (case detail) — every write to either table is rule-
--     engine-only (app_worker) → SELECT only, no INSERT/UPDATE for
--     app_runtime at all.
--   - contact_logs: append-only user-driven log → SELECT, INSERT only,
--     never UPDATE (draft_snapshot/outcome are an immutable record of what
--     was actually sent/logged — never edited after creation) or DELETE.
--   - scheduled_followups: created by app_runtime (DEFERRED contact
--     outcome, same transaction as the ContactLog insert) and mutated by
--     app_runtime (complete/reschedule endpoints) → SELECT, INSERT, UPDATE.
-- No DELETE anywhere, for any of the 5 tables, for either role.
--> statement-breakpoint
ALTER TABLE "attention_cases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "attention_reasons" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "attention_evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contact_logs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scheduled_followups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "attention_cases_tenant_isolation" ON "attention_cases"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "attention_reasons_tenant_isolation" ON "attention_reasons"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "attention_evidence_tenant_isolation" ON "attention_evidence"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "contact_logs_tenant_isolation" ON "contact_logs"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "scheduled_followups_tenant_isolation" ON "scheduled_followups"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, UPDATE ON public.attention_cases TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON public.attention_reasons TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON public.attention_evidence TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.contact_logs TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.scheduled_followups TO app_runtime;
