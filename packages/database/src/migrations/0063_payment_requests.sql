-- Billing Engine — Phase 3. payment_requests (two-phase manual-payment intent).
--
-- Additive. A customer's intent to pay for a plan, created before money moves,
-- resolved later by a platform admin verifying the manual (InstaPay/Vodafone
-- Cash) payment via a WhatsApp proof. Money = integer minor units (ADR-022). No
-- screenshot/attachment column exists — correlation is purely via human_code.
--
-- RLS/grants (least privilege):
--   * app_runtime (tenant owner): SELECT + INSERT own workspace, and UPDATE
--     restricted to cancelling its OWN PENDING request (WITH CHECK status =
--     'CANCELLED') — a tenant can NEVER set CONFIRMED/REJECTED itself.
--   * app_platform_admin: SELECT all + UPDATE only the resolution columns
--     (confirm/reject). No DELETE for anyone.
--   * A PARTIAL UNIQUE index allows at most ONE PENDING request per workspace
--     (anti-spam) — create deterministically cancels any prior PENDING first.
--
-- APPLY on a disposable/staging DB (with 0062) before deploy. NOT auto-applied
-- to Production.

CREATE TABLE IF NOT EXISTS "payment_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "requested_by_user_id" uuid NOT NULL,
  "human_code" text NOT NULL,
  "action_type" text NOT NULL,
  "target_plan_code" text NOT NULL,
  "billing_cycle" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency_code" char(3) NOT NULL DEFAULT 'EGP',
  "payment_method" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "bound_subscription_version" integer NOT NULL,
  "quote_snapshot_json" jsonb NOT NULL,
  "expires_at" timestamptz,
  "reject_reason" text,
  "resolved_by_user_id" uuid,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "payment_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict,
  CONSTRAINT "payment_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "payment_requests_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "payment_requests_human_code_unique" UNIQUE ("human_code"),
  CONSTRAINT "payment_requests_action_type_check" CHECK ("action_type" IN ('NEW_SUBSCRIPTION', 'RENEWAL', 'UPGRADE')),
  CONSTRAINT "payment_requests_billing_cycle_check" CHECK ("billing_cycle" IN ('MONTHLY', 'ANNUAL')),
  CONSTRAINT "payment_requests_method_check" CHECK ("payment_method" IN ('INSTAPAY', 'VODAFONE_CASH')),
  CONSTRAINT "payment_requests_status_check" CHECK ("status" IN ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED')),
  CONSTRAINT "payment_requests_amount_positive_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "payment_requests_reject_reason_check" CHECK ("status" <> 'REJECTED' OR "reject_reason" IS NOT NULL),
  CONSTRAINT "payment_requests_resolution_check" CHECK ("status" IN ('PENDING', 'CANCELLED', 'EXPIRED') OR ("resolved_by_user_id" IS NOT NULL AND "resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_requests_workspace_status_created_idx" ON "payment_requests" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_requests_status_created_idx" ON "payment_requests" ("status", "created_at");
--> statement-breakpoint
-- Anti-spam: at most ONE PENDING request per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_requests_one_pending_per_workspace" ON "payment_requests" ("workspace_id") WHERE "status" = 'PENDING';
--> statement-breakpoint
ALTER TABLE "payment_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "payment_requests_tenant_read" ON "payment_requests"
  FOR SELECT TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "payment_requests_tenant_insert" ON "payment_requests"
  FOR INSERT TO app_runtime
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Tenant may ONLY cancel its own PENDING request — never confirm/reject itself.
CREATE POLICY "payment_requests_tenant_cancel" ON "payment_requests"
  FOR UPDATE TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid AND status = 'PENDING')
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid AND status = 'CANCELLED');
--> statement-breakpoint
GRANT SELECT, INSERT ON public.payment_requests TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("status", "updated_at", "version") ON public.payment_requests TO app_runtime;
--> statement-breakpoint
CREATE POLICY "payment_requests_platform_admin_read" ON "payment_requests"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "payment_requests_platform_admin_resolve" ON "payment_requests"
  FOR UPDATE TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON public.payment_requests TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("status", "reject_reason", "resolved_by_user_id", "resolved_at", "updated_at", "version") ON public.payment_requests TO app_platform_admin;
