-- Phase 6 — payments. Database Schema §8.2. Immutable ledger identity — no
-- UPDATE of amount/obligation_id/etc. by ordinary flows, no DELETE ever
-- (grants in 0028 omit both). UNIQUE(workspace_id, idempotency_key)
-- backs "duplicate Idempotency-Key never creates a second payment."
--
-- Same cross-tenant Composite-FK guard as 0025 — payments(obligation_id,
-- workspace_id) → financial_obligations(id, workspace_id).
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" char(3) DEFAULT 'EGP' NOT NULL,
	"method" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_workspace_idempotency_key_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "payments_id_workspace_id_unique" UNIQUE("id","workspace_id"),
	CONSTRAINT "payments_amount_positive_check" CHECK ("payments"."amount_minor" > 0),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" IN ('CASH', 'TRANSFER', 'WALLET', 'OTHER')),
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('POSTED', 'REVERSED'))
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_obligation_workspace_fk"
  FOREIGN KEY ("obligation_id", "workspace_id") REFERENCES "public"."financial_obligations"("id", "workspace_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk"
  FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "payments_workspace_obligation_paid_at_idx" ON "payments" USING btree ("workspace_id","obligation_id","paid_at");
