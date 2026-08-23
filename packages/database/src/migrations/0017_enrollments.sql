-- Phase 4 — enrollments. Database Schema §7.1. INT-08 (one enrollment row
-- per (student, group_month)) via UNIQUE(student_id, group_month_id); the
-- CHECK ties custom_fee_minor's nullability exactly to fee_method='CUSTOM'.
-- No financial_obligations row is written anywhere in this phase (Phase 6
-- table, does not exist yet) — pre-authorized scoping decision #1.
--> statement-breakpoint
CREATE TABLE "enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"group_month_id" uuid NOT NULL,
	"join_date" date NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"fee_method" text NOT NULL,
	"custom_fee_minor" bigint,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "enrollments_status_check" CHECK ("enrollments"."status" IN ('PENDING', 'ACTIVE', 'STOPPED', 'WITHDRAWN', 'TRANSFERRED')),
	CONSTRAINT "enrollments_fee_method_check" CHECK ("enrollments"."fee_method" IN ('FULL_MONTH', 'CUSTOM', 'REMAINING_SESSIONS')),
	CONSTRAINT "enrollments_custom_fee_minor_check" CHECK (("enrollments"."fee_method" = 'CUSTOM') = ("enrollments"."custom_fee_minor" IS NOT NULL)),
	CONSTRAINT "enrollments_student_group_month_unique" UNIQUE("student_id","group_month_id")
);
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_group_month_id_group_months_id_fk"
  FOREIGN KEY ("group_month_id") REFERENCES "public"."group_months"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "enrollments_workspace_group_month_status_idx" ON "enrollments" USING btree ("workspace_id","group_month_id","status");
