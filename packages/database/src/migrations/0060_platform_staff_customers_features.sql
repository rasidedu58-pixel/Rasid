-- Platform Operations Round 2 — Staff Management + Customer Creation via Secure
-- Invite + Workspace Feature Overrides. One additive migration, three concerns:
--
--   1) platform_admins: add a reversible ACTIVE/DISABLED status (real access
--      enforcement in PlatformAdminGuard), plus invited_by / disabled_at. Grant
--      app_platform_admin the SELECT/INSERT/UPDATE it needs to LIST staff, INSERT
--      a new admin on invite-acceptance, and change role / disable-reactivate.
--      (Before this, only app_runtime had SELECT — role changes were manual SQL.)
--   2) platform_staff_invitations + platform_customer_invitations: secure,
--      expiring, single-use invite tables. Token stored as SHA-256 hash only.
--      Platform tables (no tenant RLS) — access purely by GRANT, app_platform_admin
--      only, mirroring platform_contact_logs (0056). No password is ever set by
--      an admin; no privilege/workspace is provisioned before acceptance.
--   3) workspace_feature_overrides: per-workspace ENABLE/DISABLE layered on top
--      of the GLOBAL feature_flags availability. Tenant reads its own (so the
--      runtime feature gate honors it); app_platform_admin manages cross-tenant.
--      NOT a billing entitlement, NOT an RBAC bypass. Append-only (revoke, never
--      delete). Partial unique (workspace_id, feature_key) WHERE revoked_at IS NULL.
--
-- Code that reads platform_admins.status is NOT backward-compatible with a
-- pre-0060 schema — APPLY THIS FIRST (migrate-first), then deploy. Additive.
-- NOT auto-applied to Production.

-- 1) platform_admins ---------------------------------------------------------
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'ACTIVE';
--> statement-breakpoint
ALTER TABLE "platform_admins" DROP CONSTRAINT IF EXISTS "platform_admins_status_check";
--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_status_check"
  CHECK ("status" IN ('ACTIVE', 'DISABLED'));
--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "invited_by_user_id" uuid
  REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "platform_admins" ADD COLUMN IF NOT EXISTS "disabled_at" timestamptz;
--> statement-breakpoint
-- Staff management runs on app_platform_admin: LIST (SELECT), accept-invite
-- (INSERT), change-role / disable-reactivate (UPDATE of role/status/disabled_at).
GRANT SELECT, INSERT ON public.platform_admins TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("role", "status", "disabled_at") ON public.platform_admins TO app_platform_admin;
--> statement-breakpoint

-- 2a) platform_staff_invitations --------------------------------------------
CREATE TABLE IF NOT EXISTS "platform_staff_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "role" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "accepted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_staff_invitations_role_check"
    CHECK ("role" IN ('PLATFORM_OWNER', 'OPERATIONS_ADMIN', 'SUPPORT_AGENT')),
  CONSTRAINT "platform_staff_invitations_status_check"
    CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REVOKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_staff_invitations_token_hash_unique"
  ON "platform_staff_invitations" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_staff_invitations_status_idx"
  ON "platform_staff_invitations" ("status", "created_at" DESC);
--> statement-breakpoint
GRANT SELECT, INSERT ON public.platform_staff_invitations TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("status", "accepted_by_user_id", "accepted_at", "revoked_at")
  ON public.platform_staff_invitations TO app_platform_admin;
--> statement-breakpoint

-- 2b) platform_customer_invitations -----------------------------------------
CREATE TABLE IF NOT EXISTS "platform_customer_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "token_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "accepted_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "accepted_workspace_id" uuid,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_customer_invitations_status_check"
    CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REVOKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_customer_invitations_token_hash_unique"
  ON "platform_customer_invitations" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_customer_invitations_status_idx"
  ON "platform_customer_invitations" ("status", "created_at" DESC);
--> statement-breakpoint
GRANT SELECT, INSERT ON public.platform_customer_invitations TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("status", "accepted_by_user_id", "accepted_workspace_id", "accepted_at", "revoked_at")
  ON public.platform_customer_invitations TO app_platform_admin;
--> statement-breakpoint

-- 3) workspace_feature_overrides --------------------------------------------
CREATE TABLE IF NOT EXISTS "workspace_feature_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "feature_key" text NOT NULL,
  "state" text NOT NULL,
  "reason" text NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "revoked_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "workspace_feature_overrides_state_check"
    CHECK ("state" IN ('ENABLED', 'DISABLED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_feature_overrides_active_unique"
  ON "workspace_feature_overrides" ("workspace_id", "feature_key")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_feature_overrides_workspace_idx"
  ON "workspace_feature_overrides" ("workspace_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "workspace_feature_overrides" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_feature_overrides_tenant_read" ON "workspace_feature_overrides"
  FOR SELECT TO app_runtime
  USING ("workspace_id" = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workspace_feature_overrides_platform_admin_all" ON "workspace_feature_overrides"
  FOR ALL TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON public.workspace_feature_overrides TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.workspace_feature_overrides TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("revoked_at", "revoked_by_user_id")
  ON public.workspace_feature_overrides TO app_platform_admin;
--> statement-breakpoint
-- The Customer 360 "Features" view resolves each catalog feature's GLOBAL
-- default (feature_flags) plus any workspace override — so the platform-ops
-- role needs read-only access to the global flags (still no write: flag values
-- change out-of-band, overrides are the per-workspace lever).
GRANT SELECT ON public.feature_flags TO app_platform_admin;
