-- Phase 3 — Database Schema §5.4 (group_months), §5.5 (schedule_rules),
-- §5.6 (sessions) exactly as approved. INT-02 (UNIQUE group_id +
-- operating_month_id) and INT-06 (partial UNIQUE on
-- rescheduled_from_session_id) are the Integrity Contract backstops.
--> statement-breakpoint
CREATE TABLE "group_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"operating_month_id" uuid NOT NULL,
	"location_id" uuid,
	"base_fee_minor" bigint NOT NULL,
	"currency_code" char(3) DEFAULT 'EGP' NOT NULL,
	"due_policy" text NOT NULL,
	"due_day" smallint,
	"join_fee_policy" text NOT NULL,
	"monthly_status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "group_months_base_fee_minor_check" CHECK ("group_months"."base_fee_minor" >= 0),
	CONSTRAINT "group_months_due_policy_check" CHECK ("group_months"."due_policy" IN ('UNIFIED', 'PER_GROUP', 'OVERRIDE')),
	CONSTRAINT "group_months_due_day_check" CHECK ("group_months"."due_day" IS NULL OR "group_months"."due_day" BETWEEN 1 AND 28),
	CONSTRAINT "group_months_join_fee_policy_check" CHECK ("group_months"."join_fee_policy" IN ('ASK_EVERY_TIME', 'FULL', 'REMAINING')),
	CONSTRAINT "group_months_monthly_status_check" CHECK ("group_months"."monthly_status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "group_months_group_operating_month_unique" UNIQUE("group_id","operating_month_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_month_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_minutes" integer NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "schedule_rules_weekday_check" CHECK ("schedule_rules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "schedule_rules_duration_minutes_check" CHECK ("schedule_rules"."duration_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_month_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"origin" text NOT NULL,
	"rescheduled_from_session_id" uuid,
	"billable_for_proration" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'RESCHEDULED')),
	CONSTRAINT "sessions_origin_check" CHECK ("sessions"."origin" IN ('GENERATED', 'MANUAL', 'RESCHEDULE_REPLACEMENT')),
	CONSTRAINT "sessions_duration_minutes_check" CHECK ("sessions"."duration_minutes" > 0),
	CONSTRAINT "sessions_rescheduled_from_not_self_check" CHECK ("sessions"."rescheduled_from_session_id" <> "sessions"."id"),
	CONSTRAINT "sessions_origin_reschedule_replacement_check" CHECK (("sessions"."origin" = 'RESCHEDULE_REPLACEMENT') = ("sessions"."rescheduled_from_session_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "group_months" ADD CONSTRAINT "group_months_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_months" ADD CONSTRAINT "group_months_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_months" ADD CONSTRAINT "group_months_operating_month_id_operating_months_id_fk" FOREIGN KEY ("operating_month_id") REFERENCES "public"."operating_months"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_months" ADD CONSTRAINT "group_months_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_rules" ADD CONSTRAINT "schedule_rules_group_month_id_group_months_id_fk" FOREIGN KEY ("group_month_id") REFERENCES "public"."group_months"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_group_month_id_group_months_id_fk" FOREIGN KEY ("group_month_id") REFERENCES "public"."group_months"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_rescheduled_from_session_id_sessions_id_fk" FOREIGN KEY ("rescheduled_from_session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "group_months_workspace_operating_month_idx" ON "group_months" USING btree ("workspace_id","operating_month_id");--> statement-breakpoint
CREATE INDEX "schedule_rules_group_month_idx" ON "schedule_rules" USING btree ("group_month_id");--> statement-breakpoint
-- INT-06 — at most one replacement session per original.
CREATE UNIQUE INDEX "sessions_rescheduled_from_session_unique" ON "sessions" USING btree ("rescheduled_from_session_id") WHERE "sessions"."rescheduled_from_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_workspace_group_month_scheduled_idx" ON "sessions" USING btree ("workspace_id","group_month_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "sessions_workspace_status_scheduled_idx" ON "sessions" USING btree ("workspace_id","status","scheduled_at");
