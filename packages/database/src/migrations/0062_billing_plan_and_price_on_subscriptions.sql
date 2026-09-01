-- Billing Engine — Core (Phase 1). Commercial plan + price snapshot on subscriptions.
--
-- Additive. Extends the single per-workspace `subscriptions` row with the
-- commercial dimension it never had: which PLAN the customer bought, on which
-- CYCLE, at what PRICE — and, for CUSTOM deals, the negotiated capacity.
--
--   plan_code / billing_cycle       — the plan the workspace is on (NULL while
--                                     TRIAL / never-converted). Standard codes
--                                     validated by CHECK; the Plan Catalog
--                                     (packages/contracts/src/billing-catalog.ts)
--                                     is the source of truth for their limits/prices.
--   custom_max_active_students /
--   custom_max_team_members         — per-subscription capacity, used ONLY when
--                                     plan_code = 'CUSTOM'. CHECK keeps them in
--                                     lockstep with CUSTOM.
--   current_price_minor /
--   price_currency_code /
--   plan_price_version              — the COMMERCIAL PRICE SNAPSHOT actually
--                                     agreed with THIS customer (integer minor
--                                     units, ADR-022 — never a float). Deliberately
--                                     NOT derived from the catalog at read time: a
--                                     future catalog price change must never
--                                     silently re-price an existing customer on
--                                     deploy. plan_price_version records which
--                                     catalog price generation was locked (NULL for
--                                     a hand-priced CUSTOM deal).
--
-- GRANTS: this migration TIGHTENS them (see the "GRANT hardening" section at the
-- end). The pre-existing table-wide UPDATE/INSERT for app_runtime (0037) and
-- UPDATE for app_worker (0038) would otherwise let a tenant/runtime role write
-- the new commercial columns directly — not acceptable. They are replaced with
-- column-level grants covering only the columns those roles actually write.
-- app_platform_admin (the trusted billing writer) also drops from table-wide to
-- column-level UPDATE: the state-machine surface PLUS the commercial columns,
-- but NOT identity/immutable columns (id/workspace_id/created_at/provider).
-- Row (RLS) policies are unchanged. No flow writes the commercial columns yet —
-- Phase 1 is schema + catalog + pure resolvers only (no payment workflow).
--
-- Backward compatible: every column is NULLable with no backfill — existing
-- TRIAL/ACTIVE rows keep their meaning (NULL plan = no commercial plan yet; the
-- resolvers treat a live TRIAL as the 500-student trial capacity). Code that
-- reads these columns is not backward-compatible with a pre-0062 schema —
-- APPLY THIS FIRST (migrate-first), then deploy. NOT auto-applied to Production.

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan_code" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_cycle" text;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "custom_max_active_students" integer;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "custom_max_team_members" integer;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "current_price_minor" bigint;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "price_currency_code" char(3);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan_price_version" integer;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_check"
  CHECK ("plan_code" IS NULL OR "plan_code" IN ('STARTER', 'GROWTH', 'PROFESSIONAL', 'ADVANCED', 'BUSINESS', 'BUSINESS_PLUS', 'CUSTOM'));
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_billing_cycle_check"
  CHECK ("billing_cycle" IS NULL OR "billing_cycle" IN ('MONTHLY', 'ANNUAL'));
--> statement-breakpoint
-- CUSTOM must carry both custom limits …
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_custom_requires_custom_limits_check"
  CHECK ("plan_code" IS DISTINCT FROM 'CUSTOM' OR ("custom_max_active_students" IS NOT NULL AND "custom_max_team_members" IS NOT NULL));
--> statement-breakpoint
-- … and every non-CUSTOM plan (and NULL) must carry neither. COALESCE guards the
-- NULL-passes-CHECK pitfall (a bare `plan_code = 'CUSTOM'` evaluates to NULL, not
-- FALSE, when plan_code IS NULL — which a CHECK would treat as satisfied).
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_noncustom_no_custom_limits_check"
  CHECK (COALESCE("plan_code", '') = 'CUSTOM' OR ("custom_max_active_students" IS NULL AND "custom_max_team_members" IS NULL));
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_custom_limits_positive_check"
  CHECK (("custom_max_active_students" IS NULL OR "custom_max_active_students" > 0) AND ("custom_max_team_members" IS NULL OR "custom_max_team_members" >= 0));
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_nonnegative_check"
  CHECK ("current_price_minor" IS NULL OR "current_price_minor" >= 0);
--> statement-breakpoint
-- A stored price implies a plan + cycle + currency (but NOT a version — a CUSTOM
-- price is hand-set with plan_price_version NULL).
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_implies_plan_check"
  CHECK ("current_price_minor" IS NULL OR ("plan_code" IS NOT NULL AND "billing_cycle" IS NOT NULL AND "price_currency_code" IS NOT NULL));
--> statement-breakpoint

-- ── GRANT hardening — commercial fields are NOT writable by tenant/runtime roles ──
--
-- Defense in depth at the GRANT layer, NOT RLS: the seven commercial columns
-- above (plan_code / billing_cycle / custom_max_* / current_price_minor /
-- price_currency_code / plan_price_version) must never be writable directly by
-- app_runtime or app_worker. Verified against EVERY real writer of this table:
--   • the ONLY UPDATE is updateSubscriptionStateTransaction
--     (packages/database/src/repositories/subscriptions.repository.ts), whose
--     write surface is exactly: state, period_start, period_end,
--     cancel_at_period_end, provider_subscription_id, provider_customer_id,
--     updated_at, version — no commercial column. It runs under app_runtime
--     (Paddle webhook), app_worker (expiry scan) and app_platform_admin (admin
--     action).
--   • the ONLY INSERT is provisionSubscriptionForNewWorkspaceTransaction, whose
--     surface is exactly: workspace_id, state, period_start, period_end,
--     cancel_at_period_end (id/provider/timestamps/version use column defaults).
-- So replacing the table-wide 0037/0038 grants with these column-level grants
-- breaks no existing flow, and closes plan/price/limit writes to tenant runtime.
-- app_platform_admin keeps its full table-wide UPDATE (0059): it is the trusted
-- billing writer that WILL set the commercial columns (confirm/renew/upgrade).

REVOKE INSERT, UPDATE ON public.subscriptions FROM app_runtime;
--> statement-breakpoint
GRANT INSERT ("workspace_id", "state", "period_start", "period_end", "cancel_at_period_end")
  ON public.subscriptions TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("state", "period_start", "period_end", "cancel_at_period_end", "provider_subscription_id", "provider_customer_id", "updated_at", "version")
  ON public.subscriptions TO app_runtime;
--> statement-breakpoint
REVOKE UPDATE ON public.subscriptions FROM app_worker;
--> statement-breakpoint
-- app_worker only runs the expiry scan (state → EXPIRED); it never writes the
-- provider linkage columns, so they are deliberately excluded (least privilege).
GRANT UPDATE ("state", "period_start", "period_end", "cancel_at_period_end", "updated_at", "version")
  ON public.subscriptions TO app_worker;
--> statement-breakpoint
-- app_platform_admin is the trusted billing writer (confirm/renew/upgrade/admin
-- action), so it — and ONLY it — may write the commercial columns. But it still
-- has no business rewriting identity/immutable columns: replace the table-wide
-- UPDATE (0059) with a column-level grant over exactly the state-machine surface
-- (excluding the provider linkage — no platform flow writes it) PLUS the seven
-- commercial columns. Excluded on purpose: id, workspace_id, created_at
-- (identity/immutable), the plain 'provider' discriminator, AND
-- provider_subscription_id / provider_customer_id — those are written ONLY by the
-- Paddle webhook under app_runtime; no admin action links a provider (least
-- privilege, no speculative grant).
REVOKE UPDATE ON public.subscriptions FROM app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("state", "period_start", "period_end", "cancel_at_period_end", "updated_at", "version", "plan_code", "billing_cycle", "custom_max_active_students", "custom_max_team_members", "current_price_minor", "price_currency_code", "plan_price_version")
  ON public.subscriptions TO app_platform_admin;
