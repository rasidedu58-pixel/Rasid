-- Phase 5 — adds a composite UNIQUE(id, group_month_id) to both `sessions`
-- and `enrollments`. `id` is already the primary key (and therefore already
-- unique) on both tables, so this is a cheap, purely-additive constraint —
-- its only purpose is to give the next migration's `session_records` table
-- something to attach a Composite Foreign Key to, so that Postgres itself
-- (not just RLS or application code) rejects a `session_records` row whose
-- `session_id` and `enrollment_id` do not share the SAME `group_month_id`
-- (Database Schema §7.3's own prescription: "sessions UNIQUE(id,
-- group_month_id) + enrollments UNIQUE(id, group_month_id) ثم Composite FKs
-- من session_records لمنع ربط Enrollment من GroupMonth مختلفة").
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_id_group_month_id_unique" UNIQUE ("id", "group_month_id");
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_id_group_month_id_unique" UNIQUE ("id", "group_month_id");
