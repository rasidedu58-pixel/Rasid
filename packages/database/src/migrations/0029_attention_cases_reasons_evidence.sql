-- Phase 7 — attention_cases (Database Schema §9.1), attention_reasons
-- (§9.2, WIDENED with `group_id` — see schema/attention.ts's own doc
-- comment for the full rationale: a Student can hold parallel Enrollments
-- in more than one Group while an AttentionCase stays unified at
-- (workspace_id, student_id); without a group anchor on the reason,
-- `UNIQUE(attention_case_id, rule_key)` taken literally would silently
-- merge two different groups' evidence into one reason row — a real
-- cross-group leak. This was reviewed against the approved schema first;
-- adding `group_id` is the smallest change that restores per-group
-- integrity without touching the Case's own unification rule), and
-- attention_evidence (§9.3). Hand-written (not drizzle-kit generate output)
-- to match this package's established convention of hand-authoring every
-- migration past the earliest phases, so the file only contains the tables
-- this delta actually adds.
--> statement-breakpoint
CREATE TABLE "attention_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_qualified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contacted_at" timestamp with time zone,
	"monitoring_since" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "attention_cases_id_workspace_id_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "attention_cases_status_check" CHECK ("attention_cases"."status" IN ('NEW', 'IN_FOLLOWUP', 'CONTACTED', 'MONITORING', 'CLOSED')),
	CONSTRAINT "attention_cases_priority_check" CHECK ("attention_cases"."priority" IN ('MEDIUM', 'HIGH'))
);
--> statement-breakpoint
ALTER TABLE "attention_cases" ADD CONSTRAINT "attention_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "attention_cases" ADD CONSTRAINT "attention_cases_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- §9.1's own rule, verbatim: "Partial UNIQUE(workspace_id, student_id)
-- WHERE status <> 'CLOSED'. الحالة تعبر الشهور ولا تغلق تلقائيًا لمجرد تغير
-- الشهر."
CREATE UNIQUE INDEX "attention_cases_active_unique" ON "attention_cases" USING btree ("workspace_id","student_id") WHERE "attention_cases"."status" <> 'CLOSED';
--> statement-breakpoint
CREATE INDEX "attention_cases_workspace_status_priority_idx" ON "attention_cases" USING btree ("workspace_id","status","priority");
--> statement-breakpoint
CREATE TABLE "attention_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"attention_case_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"severity" text NOT NULL,
	"first_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_reasons_case_group_rule_unique" UNIQUE("attention_case_id","group_id","rule_key"),
	CONSTRAINT "attention_reasons_id_workspace_id_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "attention_reasons_severity_check" CHECK ("attention_reasons"."severity" IN ('MEDIUM', 'HIGH'))
);
--> statement-breakpoint
-- Composite FK — proves attention_case_id belongs to the SAME workspace
-- (phase-local parent created in this same migration), same convention as
-- enrollments→financial_obligations in Phase 6.
ALTER TABLE "attention_reasons" ADD CONSTRAINT "attention_reasons_case_workspace_fk" FOREIGN KEY ("attention_case_id","workspace_id") REFERENCES "public"."attention_cases"("id","workspace_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "attention_reasons_case_idx" ON "attention_reasons" USING btree ("attention_case_id");
--> statement-breakpoint
CREATE INDEX "attention_reasons_group_idx" ON "attention_reasons" USING btree ("group_id");
--> statement-breakpoint
-- `group_id`'s cross-workspace integrity is a hand-written trigger (mirrors
-- `enrollments`/`qr_credentials`'s own EXISTS-check convention for
-- referencing a pre-existing table, Phase 4) rather than a composite FK,
-- since `groups` has no `UNIQUE(id, workspace_id)` today and adding one
-- purely for this purpose is unnecessary — the trigger achieves the same
-- integrity guarantee.
CREATE OR REPLACE FUNCTION attention_reasons_enforce_same_workspace_group()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM groups g WHERE g.id = NEW.group_id AND g.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'attention_reasons.group_id references a group belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER attention_reasons_enforce_same_workspace_group_trigger
  BEFORE INSERT OR UPDATE OF group_id, workspace_id ON attention_reasons
  FOR EACH ROW EXECUTE FUNCTION attention_reasons_enforce_same_workspace_group();
--> statement-breakpoint
CREATE TABLE "attention_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"attention_reason_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"evidence_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_evidence_reason_source_unique" UNIQUE("attention_reason_id","source_type","source_id"),
	CONSTRAINT "attention_evidence_source_type_check" CHECK ("attention_evidence"."source_type" IN ('SESSION_RECORD', 'SESSION'))
);
--> statement-breakpoint
ALTER TABLE "attention_evidence" ADD CONSTRAINT "attention_evidence_reason_workspace_fk" FOREIGN KEY ("attention_reason_id","workspace_id") REFERENCES "public"."attention_reasons"("id","workspace_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "attention_evidence_reason_observed_idx" ON "attention_evidence" USING btree ("attention_reason_id","observed_at");
