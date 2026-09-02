-- Billing Engine — Phase 5. custom_plan_offers: the platform-authored, VERSIONED
-- commercial offer answering a custom_plan_requests lead. Commercial FACTS
-- (limits/cycle/price/version) are immutable — a revised price is a NEW version
-- row (supersedes_offer_id → prior, prior.status = SUPERSEDED). Only lifecycle
-- fields (status, accepted_at, accepted_by) mutate, via narrow column grants:
--   * app_runtime (owner): SELECT own + accept/reject own PENDING_CUSTOMER
--     (UPDATE status/accepted_* only) — can NEVER alter price/limits/version.
--   * app_platform_admin: SELECT all + INSERT (create/revise) + manage status
--     (supersede/cancel/expire). No DELETE for anyone (commercial history kept).
-- effective_mode: IMMEDIATE (new / standard->custom / capacity INCREASE) vs
-- NEXT_RENEWAL (custom->custom DECREASE, scheduled — the accepted offer, not
-- pending_*, represents scheduled custom terms). price authorized by a human;
-- adjustment_reason mandatory when price != recommendation (also enforced by
-- validateCustomOffer + the CHECK below).
--
-- APPLY on a disposable/staging DB (with 0062-0067) before deploy. NOT
-- auto-applied to Production.

CREATE TABLE IF NOT EXISTS "custom_plan_offers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "custom_request_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "offer_version" integer NOT NULL,
  "max_active_students" integer NOT NULL,
  "max_team_members" integer NOT NULL,
  "billing_cycle" text NOT NULL,
  "price_minor" bigint NOT NULL,
  "currency_code" char(3) NOT NULL DEFAULT 'EGP',
  "recommendation_price_minor" bigint NOT NULL,
  "price_difference_minor" bigint NOT NULL,
  "adjustment_reason" text,
  "commercial_note" text,
  "effective_mode" text NOT NULL DEFAULT 'IMMEDIATE',
  "valid_until" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING_CUSTOMER',
  "created_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "accepted_at" timestamptz,
  "accepted_by" uuid,
  "supersedes_offer_id" uuid,
  CONSTRAINT "custom_plan_offers_custom_request_id_fk" FOREIGN KEY ("custom_request_id") REFERENCES "public"."custom_plan_requests"("id") ON DELETE restrict,
  CONSTRAINT "custom_plan_offers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict,
  CONSTRAINT "custom_plan_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "custom_plan_offers_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "custom_plan_offers_supersedes_offer_id_fk" FOREIGN KEY ("supersedes_offer_id") REFERENCES "public"."custom_plan_offers"("id") ON DELETE restrict,
  CONSTRAINT "custom_plan_offers_request_version_unique" UNIQUE ("custom_request_id", "offer_version"),
  CONSTRAINT "custom_plan_offers_students_above_standard_check" CHECK ("max_active_students" > 3000),
  CONSTRAINT "custom_plan_offers_team_nonnegative_check" CHECK ("max_team_members" >= 0),
  CONSTRAINT "custom_plan_offers_billing_cycle_check" CHECK ("billing_cycle" IN ('MONTHLY', 'ANNUAL')),
  CONSTRAINT "custom_plan_offers_price_positive_check" CHECK ("price_minor" > 0),
  CONSTRAINT "custom_plan_offers_effective_mode_check" CHECK ("effective_mode" IN ('IMMEDIATE', 'NEXT_RENEWAL')),
  -- APPLIED = the accepted terms were consumed by a CONFIRMED payment/activation
  -- (exactly-once). An offer can never be re-applied or re-accepted after this.
  CONSTRAINT "custom_plan_offers_status_check" CHECK ("status" IN ('PENDING_CUSTOMER', 'ACCEPTED', 'APPLIED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED')),
  -- A price that differs from the internal recommendation REQUIRES a human reason.
  CONSTRAINT "custom_plan_offers_price_reason_check" CHECK ("price_difference_minor" = 0 OR "adjustment_reason" IS NOT NULL),
  -- ACCEPTED / APPLIED imply acceptance provenance.
  CONSTRAINT "custom_plan_offers_accept_provenance_check" CHECK ("status" NOT IN ('ACCEPTED', 'APPLIED') OR ("accepted_at" IS NOT NULL AND "accepted_by" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_plan_offers_workspace_status_idx" ON "custom_plan_offers" ("workspace_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_plan_offers_request_idx" ON "custom_plan_offers" ("custom_request_id");
--> statement-breakpoint
-- At most one live (PENDING_CUSTOMER) offer per request at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "custom_plan_offers_one_pending_per_request" ON "custom_plan_offers" ("custom_request_id") WHERE "status" = 'PENDING_CUSTOMER';
--> statement-breakpoint
ALTER TABLE "custom_plan_offers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "custom_plan_offers_tenant_read" ON "custom_plan_offers"
  FOR SELECT TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Owner accepts/rejects its own live offer (status + acceptance provenance only).
CREATE POLICY "custom_plan_offers_tenant_resolve" ON "custom_plan_offers"
  FOR UPDATE TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid AND status = 'PENDING_CUSTOMER')
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid AND status IN ('ACCEPTED', 'REJECTED'));
--> statement-breakpoint
GRANT SELECT ON public.custom_plan_offers TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("status", "accepted_at", "accepted_by") ON public.custom_plan_offers TO app_runtime;
--> statement-breakpoint
CREATE POLICY "custom_plan_offers_platform_admin_read" ON "custom_plan_offers"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "custom_plan_offers_platform_admin_insert" ON "custom_plan_offers"
  FOR INSERT TO app_platform_admin WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "custom_plan_offers_platform_admin_manage" ON "custom_plan_offers"
  FOR UPDATE TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT ON public.custom_plan_offers TO app_platform_admin;
--> statement-breakpoint
-- Admin manages only lifecycle status (supersede / cancel / expire) — never the
-- immutable commercial columns (no grant on them = they can never be UPDATEd).
GRANT UPDATE ("status") ON public.custom_plan_offers TO app_platform_admin;
