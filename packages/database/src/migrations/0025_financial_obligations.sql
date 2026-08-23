-- Phase 6 — financial_obligations. Database Schema §8.1. One obligation per
-- Enrollment for its whole lifetime (UNIQUE(enrollment_id) — an Enrollment
-- row is REUSED across join/withdraw/rejoin cycles, INT-08). Payment ledger
-- + this table ARE the financial source of truth; amount_paid_minor/
-- remaining_minor/status are cached aggregates, mutated ONLY inside the
-- RecordPayment/ReversePayment transactions (0026/0027).
--
-- Also adds enrollments(id, workspace_id) UNIQUE — same Composite-FK
-- cross-tenant guard technique as Phase 5's sessions/enrollments(id,
-- group_month_id) (0020), applied here for WORKSPACE consistency instead
-- of group_month consistency: it is the target of financial_obligations'
-- own composite FK below, guaranteeing a workspace_id can never be
-- inserted that doesn't match its enrollment's real workspace.
--> statement-breakpoint
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_id_workspace_id_unique" UNIQUE ("id", "workspace_id");
--> statement-breakpoint
CREATE TABLE "financial_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"currency_code" char(3) DEFAULT 'EGP' NOT NULL,
	"base_fee_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"waiver_minor" bigint DEFAULT 0 NOT NULL,
	"net_due_minor" bigint NOT NULL,
	"due_date" date NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"remaining_minor" bigint NOT NULL,
	"status" text DEFAULT 'UNPAID' NOT NULL,
	"calculation_basis" text NOT NULL,
	"calculation_snapshot_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "financial_obligations_enrollment_unique" UNIQUE("enrollment_id"),
	CONSTRAINT "financial_obligations_id_workspace_id_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "financial_obligations_status_check" CHECK ("financial_obligations"."status" IN ('UNPAID', 'PARTIAL', 'PAID')),
	CONSTRAINT "financial_obligations_calculation_basis_check" CHECK ("financial_obligations"."calculation_basis" IN ('FULL_MONTH', 'CUSTOM', 'REMAINING_SESSIONS')),
	CONSTRAINT "financial_obligations_amounts_nonnegative_check" CHECK ("financial_obligations"."base_fee_minor" >= 0 AND "financial_obligations"."discount_minor" >= 0 AND "financial_obligations"."waiver_minor" >= 0),
	CONSTRAINT "financial_obligations_discount_waiver_check" CHECK ("financial_obligations"."discount_minor" + "financial_obligations"."waiver_minor" <= "financial_obligations"."base_fee_minor"),
	CONSTRAINT "financial_obligations_net_due_check" CHECK ("financial_obligations"."net_due_minor" = "financial_obligations"."base_fee_minor" - "financial_obligations"."discount_minor" - "financial_obligations"."waiver_minor"),
	CONSTRAINT "financial_obligations_paid_nonnegative_check" CHECK ("financial_obligations"."amount_paid_minor" >= 0),
	CONSTRAINT "financial_obligations_remaining_nonnegative_check" CHECK ("financial_obligations"."remaining_minor" >= 0),
	CONSTRAINT "financial_obligations_balance_check" CHECK ("financial_obligations"."amount_paid_minor" + "financial_obligations"."remaining_minor" = "financial_obligations"."net_due_minor")
);
--> statement-breakpoint
-- Composite FK (enrollment_id, workspace_id) → enrollments(id, workspace_id)
-- — the actual cross-tenant guard: a financial_obligations row's
-- workspace_id is forced to match the real workspace of the enrollment it
-- references (plain FK on enrollment_id alone only proves EXISTENCE, not
-- same-tenant, per the pattern established repeatedly since Phase 4).
ALTER TABLE "financial_obligations" ADD CONSTRAINT "financial_obligations_enrollment_workspace_fk"
  FOREIGN KEY ("enrollment_id", "workspace_id") REFERENCES "public"."enrollments"("id", "workspace_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "financial_obligations_workspace_status_due_date_idx" ON "financial_obligations" USING btree ("workspace_id","status","due_date");
--> statement-breakpoint
CREATE INDEX "financial_obligations_workspace_due_date_idx" ON "financial_obligations" USING btree ("workspace_id","due_date");
