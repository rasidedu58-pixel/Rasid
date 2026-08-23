-- Phase 6 — payment_reversals. Database Schema §8.3. UNIQUE(payment_id) —
-- a Payment may be reversed at most once in V1; the original Payment row
-- is never deleted or mutated beyond its own status column.
--> statement-breakpoint
CREATE TABLE "payment_reversals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"reversed_by" uuid NOT NULL,
	"reversed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversals_payment_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
-- Same cross-tenant Composite-FK guard as 0025/0026 — payment_reversals
-- (payment_id, workspace_id) → payments(id, workspace_id).
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_payment_workspace_fk"
  FOREIGN KEY ("payment_id", "workspace_id") REFERENCES "public"."payments"("id", "workspace_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_reversals" ADD CONSTRAINT "payment_reversals_reversed_by_users_id_fk"
  FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
