-- Phase 9 — exports: metadata-only technical table backing
-- POST /reports/export, GET /exports/{id}, GET /exports/{id}/download — see
-- schema/reports.ts's own doc comment for why it carries no CSV content
-- column (re-computed at download time instead).
--> statement-breakpoint
CREATE TABLE "exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by_membership_id" uuid NOT NULL,
	"type" text NOT NULL,
	"format" text DEFAULT 'CSV' NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'READY' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exports_type_check" CHECK ("exports"."type" IN ('STUDENT', 'GROUP', 'MONTHLY_TEACHER')),
	CONSTRAINT "exports_format_check" CHECK ("exports"."format" = 'CSV'),
	CONSTRAINT "exports_status_check" CHECK ("exports"."status" IN ('QUEUED', 'READY', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "exports" ADD CONSTRAINT "exports_requested_by_membership_id_memberships_id_fk" FOREIGN KEY ("requested_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "exports_workspace_created_idx" ON "exports" USING btree ("workspace_id","created_at");
