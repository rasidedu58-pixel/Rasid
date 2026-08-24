-- Phase 9 — notifications (Database Schema §10.4), plus `dedup_key` (a
-- necessary addition — see schema/notifications.ts's own doc comment for
-- the full rationale: a DB-level dedup invariant so concurrent/retried
-- worker scans can never create duplicate rows).
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"dedup_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedup_unique" UNIQUE("workspace_id","user_id","type","entity_type","entity_id","dedup_key"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" IN ('SUBSCRIPTION_EXPIRING', 'FOLLOWUP_DUE', 'MISSING_RECORDS'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_user_read_created_idx" ON "notifications" USING btree ("user_id","read_at","created_at");
