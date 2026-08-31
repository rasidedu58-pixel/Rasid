-- Operating-Month Overrides — a per-workspace OPERATIONAL exception set by
-- Rasid staff and read by the tenant month-prepare flow. NOT a feature
-- entitlement (never grants CREATE_MONTH, never extends a subscription).
--
-- Access model:
--   * app_platform_admin (Platform Ops) WRITES overrides (grant + revoke) and
--     reads them cross-tenant — SELECT + INSERT + column-level UPDATE (revoke
--     stamps only). No DELETE (append-only history).
--   * app_runtime (the tenant month flow) READS its own workspace's overrides —
--     SELECT only, scoped by the tenant-isolation RLS policy.
-- This migration does NOT grant app_platform_admin any write on operating_months
-- itself — month lifecycle stays entirely in the tenant Scheduling service.
--
-- Uniqueness is PostgreSQL-safe: a partial unique index on (workspace_id, type)
-- WHERE revoked_at IS NULL (no now()-based predicate). Creating a new override
-- revokes the prior same-type row first, in one transaction, so at most one
-- non-revoked override per (workspace, type) exists.
--
-- NOT auto-applied to Production — apply via the safe preflight. Additive.

CREATE TABLE IF NOT EXISTS "platform_operating_month_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "type" text NOT NULL,
  "reason" text NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "platform_operating_month_overrides_type_check"
    CHECK ("type" IN ('EARLY_PREP_ALLOWED', 'PREP_BLOCKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_op_month_overrides_active_unique"
  ON "platform_operating_month_overrides" ("workspace_id", "type")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_op_month_overrides_workspace_idx"
  ON "platform_operating_month_overrides" ("workspace_id", "created_at" DESC);
--> statement-breakpoint

-- RLS: tenant reads its own workspace; platform admin reads/writes cross-tenant.
ALTER TABLE "platform_operating_month_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "op_month_overrides_tenant_read" ON "platform_operating_month_overrides"
  FOR SELECT TO app_runtime
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "op_month_overrides_platform_admin_all" ON "platform_operating_month_overrides"
  FOR ALL TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint

-- Grants — narrowest possible.
GRANT SELECT ON public.platform_operating_month_overrides TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.platform_operating_month_overrides TO app_platform_admin;
--> statement-breakpoint
-- Only the revoke stamps are updatable (type / reason / workspace / created_* are immutable). No DELETE.
GRANT UPDATE ("revoked_at", "revoked_by_user_id")
  ON public.platform_operating_month_overrides TO app_platform_admin;
