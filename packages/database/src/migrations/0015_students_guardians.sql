-- Phase 4 — Students / Guardians. Database Schema §6.1 (students), §6.2
-- (guardians), §6.3 (student_guardians). Hand-written to match the Drizzle
-- schema in packages/database/src/schema/students.ts and guardians.ts,
-- including the GIN pg_trgm index on students.search_name_normalized
-- (Database Schema §13.1), which drizzle-kit generate cannot express.
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_code" text NOT NULL,
	"name" text NOT NULL,
	"search_name_normalized" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "students_status_check" CHECK ("students"."status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "students_workspace_student_code_unique" UNIQUE("workspace_id","student_code")
);
--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "students_workspace_status_idx" ON "students" USING btree ("workspace_id","status");
--> statement-breakpoint
-- Arabic-aware fuzzy name search (API Contract §13) — GIN trigram index.
CREATE INDEX "students_search_name_trgm_idx" ON "students" USING gin ("search_name_normalized" gin_trgm_ops);
--> statement-breakpoint
CREATE TABLE "guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text,
	"phone" text NOT NULL,
	"normalized_phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Deliberately NOT unique (Database Schema §6.2: "وليس UNIQUE في V1" — no
-- automatic merge just because two students share a guardian phone).
CREATE INDEX "guardians_workspace_normalized_phone_idx" ON "guardians" USING btree ("workspace_id","normalized_phone");
--> statement-breakpoint
CREATE TABLE "student_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"relationship" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"academic_contact_enabled" boolean DEFAULT true NOT NULL,
	"financial_contact_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_guardians_student_guardian_unique" UNIQUE("student_id","guardian_id")
);
--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardian_id_guardians_id_fk"
  FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- INT-03 — at most one primary guardian per student.
CREATE UNIQUE INDEX "student_guardians_student_primary_unique" ON "student_guardians" USING btree ("student_id") WHERE "student_guardians"."is_primary" = true;
--> statement-breakpoint
CREATE INDEX "student_guardians_guardian_idx" ON "student_guardians" USING btree ("guardian_id");
