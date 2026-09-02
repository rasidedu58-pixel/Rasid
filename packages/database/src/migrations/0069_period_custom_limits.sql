-- Billing Engine — Phase 5. Additive: carry the agreed CUSTOM capacity on each
-- ledger period so a CUSTOM period fully self-describes its commercial terms
-- (plan + price + limits). Without this, the worker promoting a FUTURE custom
-- period at its boundary would have no source for custom_max_* (a real blocker
-- for CUSTOM->CUSTOM change-at-renewal). Nullable — set only for CUSTOM rows;
-- NULL for standard rows (their limits come from the catalog).
--
-- No new grants needed: app_platform_admin already has INSERT on the table, and
-- the ledger stays append-only (no UPDATE/DELETE for any app role).
--
-- APPLY on a disposable/staging DB (with 0062-0068) before deploy. NOT
-- auto-applied to Production.

ALTER TABLE "subscription_periods" ADD COLUMN IF NOT EXISTS "custom_max_active_students" integer;
--> statement-breakpoint
ALTER TABLE "subscription_periods" ADD COLUMN IF NOT EXISTS "custom_max_team_members" integer;
--> statement-breakpoint
-- A CUSTOM period must carry both custom limits; a non-CUSTOM period carries neither.
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_custom_limits_check" CHECK (
  ("plan_code" = 'CUSTOM' AND "custom_max_active_students" IS NOT NULL AND "custom_max_team_members" IS NOT NULL)
  OR
  ("plan_code" <> 'CUSTOM' AND "custom_max_active_students" IS NULL AND "custom_max_team_members" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_custom_limits_positive_check" CHECK (
  ("custom_max_active_students" IS NULL OR "custom_max_active_students" > 3000)
  AND ("custom_max_team_members" IS NULL OR "custom_max_team_members" >= 0)
);
--> statement-breakpoint
-- The worker promotes a due FUTURE CUSTOM period into the aggregate at its
-- boundary, so it must be able to copy the agreed custom limits (0066 granted it
-- plan_code/price but NOT custom_max_*). app_platform_admin already holds these
-- (0062). Still no grant for app_runtime — commercial limits are server-set only.
GRANT UPDATE ("custom_max_active_students", "custom_max_team_members") ON public.subscriptions TO app_worker;
