-- Billing Engine — Phase 3. subscription_payments (+ reversals): the IMMUTABLE
-- SaaS-payment ledger (distinct from the student-fee ledger in Phase 6).
--
-- Additive. Mirrors the finance ledger philosophy (ADR-022): money = bigint
-- minor units. A payment row is a TRULY immutable posted fact — never UPDATEd,
-- never DELETEd, and it carries NO mutable status column: "reversed" is DERIVED
-- from the existence of a subscription_payment_reversals row for it. payment_
-- request_id UNIQUE (one payment per request) + (workspace_id, idempotency_key)
-- UNIQUE (no double-confirm).
--
-- RLS/grants (least privilege):
--   * app_runtime (tenant): SELECT own workspace ONLY — never INSERT/UPDATE/DELETE.
--   * app_platform_admin: SELECT all + INSERT (the confirm creates the payment /
--     reversal). NO UPDATE (immutable), NO DELETE for anyone.
--
-- APPLY on a disposable/staging DB (with 0062, 0063) before deploy. NOT
-- auto-applied to Production.

CREATE TABLE IF NOT EXISTS "subscription_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "payment_request_id" uuid NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency_code" char(3) NOT NULL DEFAULT 'EGP',
  "method" text NOT NULL,
  "confirmation_source" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "confirmed_by" uuid NOT NULL,
  "confirmed_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "subscription_payments_payment_request_id_fk" FOREIGN KEY ("payment_request_id") REFERENCES "public"."payment_requests"("id") ON DELETE restrict,
  CONSTRAINT "subscription_payments_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "subscription_payments_request_unique" UNIQUE ("payment_request_id"),
  CONSTRAINT "subscription_payments_workspace_idempotency_key_unique" UNIQUE ("workspace_id", "idempotency_key"),
  CONSTRAINT "subscription_payments_amount_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "subscription_payments_method_check" CHECK ("method" IN ('INSTAPAY', 'VODAFONE_CASH', 'MANUAL_ADJUSTMENT')),
  CONSTRAINT "subscription_payments_source_check" CHECK ("confirmation_source" IN ('MANUAL_ADMIN', 'PAYMENT_GATEWAY_WEBHOOK'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_payments_workspace_created_idx" ON "subscription_payments" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_payment_reversals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "payment_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "reversed_by" uuid NOT NULL,
  "reversed_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "subscription_payment_reversals_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."subscription_payments"("id") ON DELETE restrict,
  CONSTRAINT "subscription_payment_reversals_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "subscription_payment_reversals_payment_unique" UNIQUE ("payment_id")
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscription_payment_reversals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Tenant reads its own SaaS payments (read-only). No write path for app_runtime.
CREATE POLICY "subscription_payments_tenant_read" ON "subscription_payments"
  FOR SELECT TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "subscription_payment_reversals_tenant_read" ON "subscription_payment_reversals"
  FOR SELECT TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT ON public.subscription_payments TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON public.subscription_payment_reversals TO app_runtime;
--> statement-breakpoint
-- Platform admin (trusted billing writer): read all + append (INSERT) only.
CREATE POLICY "subscription_payments_platform_admin_read" ON "subscription_payments"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "subscription_payments_platform_admin_insert" ON "subscription_payments"
  FOR INSERT TO app_platform_admin WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "subscription_payment_reversals_platform_admin_read" ON "subscription_payment_reversals"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "subscription_payment_reversals_platform_admin_insert" ON "subscription_payment_reversals"
  FOR INSERT TO app_platform_admin WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON public.subscription_payments TO app_platform_admin;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.subscription_payment_reversals TO app_platform_admin;
