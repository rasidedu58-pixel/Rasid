-- Phase 3 — Months / Groups / Scheduling, Database Schema §5.1 (locations),
-- §5.2 (operating_months), §5.3 (groups) exactly as approved.
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "locations_status_check" CHECK ("locations"."status" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
CREATE TABLE "operating_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "operating_months_year_check" CHECK ("operating_months"."year" BETWEEN 2020 AND 2100),
	CONSTRAINT "operating_months_month_check" CHECK ("operating_months"."month" BETWEEN 1 AND 12),
	CONSTRAINT "operating_months_status_check" CHECK ("operating_months"."status" IN ('DRAFT', 'CURRENT', 'ARCHIVED')),
	CONSTRAINT "operating_months_workspace_year_month_unique" UNIQUE("workspace_id","year","month")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text,
	"grade" text,
	"default_location_id" uuid,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "groups_status_check" CHECK ("groups"."status" IN ('ACTIVE', 'ARCHIVED'))
);
--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_months" ADD CONSTRAINT "operating_months_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_months" ADD CONSTRAINT "operating_months_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_default_location_id_locations_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- INT-01 — exactly one CURRENT operating month per workspace.
CREATE UNIQUE INDEX "operating_months_workspace_current_unique" ON "operating_months" USING btree ("workspace_id") WHERE "operating_months"."status" = 'CURRENT';--> statement-breakpoint
CREATE INDEX "groups_workspace_status_idx" ON "groups" USING btree ("workspace_id","status");
