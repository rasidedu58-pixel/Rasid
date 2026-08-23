-- Phase 7 — contact_logs (Database Schema §9.4) and scheduled_followups
-- (§9.5), exactly as approved (no widening needed here — see
-- schema/followup.ts's own doc comment for why).
--> statement-breakpoint
CREATE TABLE "contact_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"attention_case_id" uuid,
	"session_id" uuid,
	"channel" text NOT NULL,
	"draft_snapshot" text NOT NULL,
	"outcome" text NOT NULL,
	"notes" text,
	"follow_up_at" timestamp with time zone,
	"actor_user_id" uuid NOT NULL,
	"actor_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_logs_id_workspace_id_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "contact_logs_channel_check" CHECK ("contact_logs"."channel" IN ('WHATSAPP_DEEPLINK', 'CALL', 'OTHER')),
	CONSTRAINT "contact_logs_outcome_check" CHECK ("contact_logs"."outcome" IN ('CONTACTED', 'NO_ANSWER', 'INVALID_NUMBER', 'DEFERRED')),
	CONSTRAINT "contact_logs_follow_up_at_required_on_defer_check" CHECK (("contact_logs"."outcome" = 'DEFERRED') = ("contact_logs"."follow_up_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "contact_logs" ADD CONSTRAINT "contact_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact_logs" ADD CONSTRAINT "contact_logs_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- §15 ON DELETE policy: "ContactLog optional Session/Case context — SET
-- NULL فقط إذا بقي السجل مفهومًا" — the log row itself is never removed.
ALTER TABLE "contact_logs" ADD CONSTRAINT "contact_logs_attention_case_id_attention_cases_id_fk" FOREIGN KEY ("attention_case_id") REFERENCES "public"."attention_cases"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "contact_logs_student_idx" ON "contact_logs" USING btree ("student_id");
--> statement-breakpoint
CREATE INDEX "contact_logs_case_idx" ON "contact_logs" USING btree ("attention_case_id");
--> statement-breakpoint
-- `guardian_id`/`session_id` cross-workspace integrity — hand-written
-- trigger (mirrors `student_guardians`/`qr_credentials`'s own EXISTS-check
-- convention, Phase 4), since `guardians`/`sessions` reference two
-- pre-existing tables and a plain FK only proves existence, not tenant.
-- `session_id` is nullable ("سياق الحصة عند وجوده") — only checked when
-- present.
CREATE OR REPLACE FUNCTION contact_logs_enforce_same_workspace()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM guardians g WHERE g.id = NEW.guardian_id AND g.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'contact_logs.guardian_id references a guardian belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sessions s WHERE s.id = NEW.session_id AND s.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'contact_logs.session_id references a session belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER contact_logs_enforce_same_workspace_trigger
  BEFORE INSERT OR UPDATE OF guardian_id, session_id, workspace_id ON contact_logs
  FOR EACH ROW EXECUTE FUNCTION contact_logs_enforce_same_workspace();
--> statement-breakpoint
CREATE TABLE "scheduled_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"attention_case_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"assignee_membership_id" uuid,
	"source_contact_log_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "scheduled_followups_status_check" CHECK ("scheduled_followups"."status" IN ('PENDING', 'DONE', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_source_contact_log_id_contact_logs_id_fk" FOREIGN KEY ("source_contact_log_id") REFERENCES "public"."contact_logs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Composite FK to the phase-local parent (attention_cases), same pattern
-- as 0029's attention_reasons→attention_cases guard.
ALTER TABLE "scheduled_followups" ADD CONSTRAINT "scheduled_followups_case_workspace_fk" FOREIGN KEY ("attention_case_id","workspace_id") REFERENCES "public"."attention_cases"("id","workspace_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "scheduled_followups_workspace_status_due_idx" ON "scheduled_followups" USING btree ("workspace_id","status","due_at");
--> statement-breakpoint
-- `assignee_membership_id` cross-workspace integrity — hand-written
-- trigger; the column exists in the approved schema but has zero described
-- mutation flow (no endpoint, no business rule) in this phase, so it is
-- never written by application code today — still guarded at the DB level
-- for defense-in-depth, matching this codebase's "guard every FK-shaped
-- reference to a pre-existing table" posture.
CREATE OR REPLACE FUNCTION scheduled_followups_enforce_same_workspace_assignee()
RETURNS trigger AS $$
BEGIN
  IF NEW.assignee_membership_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.id = NEW.assignee_membership_id AND m.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'scheduled_followups.assignee_membership_id references a membership belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER scheduled_followups_enforce_same_workspace_assignee_trigger
  BEFORE INSERT OR UPDATE OF assignee_membership_id, workspace_id ON scheduled_followups
  FOR EACH ROW EXECUTE FUNCTION scheduled_followups_enforce_same_workspace_assignee();
