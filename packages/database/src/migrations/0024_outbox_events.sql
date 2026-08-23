-- Phase 5 Closure Delta — outbox_events (Database Schema §11.2, pulled
-- forward per Technical Architecture ADR-018 "Transactional Outbox من
-- البداية — APPROVED" + the Implementation Plan's own Phase 5 deliverable
-- line naming "Complete Session transaction + outbox"). Infrastructure
-- only: no consumer/worker in this delta. app_runtime gets SELECT+INSERT
-- only — status transitions (PROCESSING/PROCESSED/FAILED) belong to a
-- future worker phase and its own role, not granted here.
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED'))
);
--> statement-breakpoint
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events" USING btree ("status","available_at") WHERE status IN ('PENDING', 'FAILED');
--> statement-breakpoint
-- Same ADR-017 tenant-isolation pattern as every other table (0007/0012/
-- 0019/0022's NULLIF-guarded pattern) — applied here even though nothing
-- reads this table yet, for consistency with this codebase's "RLS + grants
-- always together" posture. A NULL workspace_id (system-level event) never
-- matches any tenant's setting, so it is invisible to app_runtime under
-- every workspace context — correct: a future dispatch worker reads
-- PENDING events via its own privileged role, not app_runtime, so this
-- never blocks real dispatch.
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "outbox_events_tenant_isolation" ON "outbox_events"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON public.outbox_events TO app_runtime;
