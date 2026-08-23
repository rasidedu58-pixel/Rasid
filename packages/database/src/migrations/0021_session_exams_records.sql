-- Phase 5 — session_exams + session_records. Database Schema §7.2/§7.3.
-- session_records' cross-group integrity is enforced by TWO Composite
-- Foreign Keys against the UNIQUE(id, group_month_id) constraints added in
-- 0020 — the exact mechanism the approved schema prescribes, rather than a
-- trigger (the pattern used in Phase 3/4 only because no matching unique
-- target existed yet at the time).
--> statement-breakpoint
CREATE TABLE "session_exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text,
	"max_score" numeric(8, 2) NOT NULL,
	"low_score_threshold" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "session_exams_session_unique" UNIQUE("session_id"),
	CONSTRAINT "session_exams_max_score_check" CHECK ("session_exams"."max_score" > 0),
	CONSTRAINT "session_exams_low_score_threshold_check" CHECK ("session_exams"."low_score_threshold" IS NULL OR ("session_exams"."low_score_threshold" >= 0 AND "session_exams"."low_score_threshold" <= "session_exams"."max_score"))
);
--> statement-breakpoint
ALTER TABLE "session_exams" ADD CONSTRAINT "session_exams_session_id_sessions_id_fk"
  FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "session_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_month_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"attendance_status" text,
	"homework_status" text,
	"exam_status" text DEFAULT 'NO_EXAM' NOT NULL,
	"exam_score" numeric(8, 2),
	"notes" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "session_records_session_enrollment_unique" UNIQUE("session_id","enrollment_id"),
	CONSTRAINT "session_records_attendance_status_check" CHECK ("session_records"."attendance_status" IS NULL OR "session_records"."attendance_status" IN ('PRESENT', 'ABSENT', 'LATE')),
	CONSTRAINT "session_records_homework_status_check" CHECK ("session_records"."homework_status" IS NULL OR "session_records"."homework_status" IN ('DONE', 'PARTIAL', 'NOT_DONE', 'NO_HOMEWORK')),
	CONSTRAINT "session_records_exam_status_check" CHECK ("session_records"."exam_status" IN ('NO_EXAM', 'SCORED', 'ABSENT_FROM_EXAM')),
	CONSTRAINT "session_records_exam_score_check" CHECK (("session_records"."exam_status" = 'SCORED') = ("session_records"."exam_score" IS NOT NULL)),
	CONSTRAINT "session_records_exam_score_nonnegative_check" CHECK ("session_records"."exam_score" IS NULL OR "session_records"."exam_score" >= 0)
);
--> statement-breakpoint
ALTER TABLE "session_records" ADD CONSTRAINT "session_records_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_records" ADD CONSTRAINT "session_records_updated_by_users_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Composite FKs — the actual cross-group guard. A session_records row's
-- (session_id, group_month_id) pair must match a real sessions row, AND its
-- (enrollment_id, group_month_id) pair must match a real enrollments row —
-- so session_id and enrollment_id are transitively forced to share the same
-- group_month_id, and group_month_id itself is forced to be the true one.
ALTER TABLE "session_records" ADD CONSTRAINT "session_records_session_group_month_fk"
  FOREIGN KEY ("session_id", "group_month_id") REFERENCES "public"."sessions"("id", "group_month_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_records" ADD CONSTRAINT "session_records_enrollment_group_month_fk"
  FOREIGN KEY ("enrollment_id", "group_month_id") REFERENCES "public"."enrollments"("id", "group_month_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "session_records_workspace_session_idx" ON "session_records" USING btree ("workspace_id","session_id");
--> statement-breakpoint
CREATE INDEX "session_records_workspace_enrollment_idx" ON "session_records" USING btree ("workspace_id","enrollment_id");
