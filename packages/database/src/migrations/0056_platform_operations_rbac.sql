-- Platform Operations — RBAC + Unit 1 (Customer Communication + Follow-up).
--
-- Adds the company-level role model on top of the `platform_admins` allowlist
-- and the first two WRITE tables for the internal ops console. This is the
-- first migration that grants `app_platform_admin` any write privilege — and
-- ONLY on PLATFORM tables (never on tenant data). The new tables follow the
-- exact same access model as `platform_admins`/`platform_audit_events`: NOT
-- tenant data, so NO row-level-security policy — access is controlled purely
-- by GRANT, and only `app_platform_admin` is ever granted anything here.
--
-- Deliberately NOT auto-applied to Production — apply via the same safe
-- preflight used for every other platform migration. Additive and reversible.

-- 1) RBAC role on the allowlist -------------------------------------------------
-- LEAST-PRIVILEGE BACKFILL: this migration grants NO operational privilege to
-- anyone for merely having existed in the old allowlist. The new NOT NULL
-- column defaults to SUPPORT_AGENT, so every existing row is backfilled to
-- SUPPORT_AGENT as well (the ADD COLUMN default applies to existing rows). No
-- UPDATE promotes anyone. PLATFORM_OWNER and OPERATIONS_ADMIN are granted ONLY
-- later, explicitly, out-of-band, per chosen account (see the template at the
-- end of this file) — with no email/user_id hardcoded here.
ALTER TABLE "platform_admins"
  ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'SUPPORT_AGENT';
--> statement-breakpoint
ALTER TABLE "platform_admins"
  DROP CONSTRAINT IF EXISTS "platform_admins_role_check";
--> statement-breakpoint
ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_role_check"
  CHECK ("role" IN ('PLATFORM_OWNER', 'OPERATIONS_ADMIN', 'SUPPORT_AGENT'));
--> statement-breakpoint

-- 2) Unit 1 tables --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "platform_contact_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "direction" text NOT NULL DEFAULT 'OUTBOUND',
  "summary" text NOT NULL,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_contact_logs_channel_check"
    CHECK ("channel" IN ('CALL', 'WHATSAPP', 'EMAIL', 'SMS', 'IN_PERSON', 'OTHER')),
  CONSTRAINT "platform_contact_logs_direction_check"
    CHECK ("direction" IN ('OUTBOUND', 'INBOUND'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_follow_ups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "title" text NOT NULL,
  "note" text,
  "due_at" timestamptz,
  "status" text NOT NULL DEFAULT 'PENDING',
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "assigned_to_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "resolved_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "platform_follow_ups_status_check"
    CHECK ("status" IN ('PENDING', 'DONE', 'CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_contact_logs_workspace_idx"
  ON "platform_contact_logs" ("workspace_id", "occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_follow_ups_workspace_idx"
  ON "platform_follow_ups" ("workspace_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_follow_ups_queue_idx"
  ON "platform_follow_ups" ("status", "due_at");
--> statement-breakpoint

-- 3) Grants — narrowest possible, platform tables only, app_platform_admin only.
-- NOTHING here grants write on users / workspaces / subscriptions / operating
-- months / any tenant business table / platform_admins role management. The
-- ALTER above changes the platform_admins SCHEMA (a migration-role DDL op); it
-- does NOT grant app_platform_admin any write on platform_admins.
--
-- Append-only contact logs: SELECT + INSERT only (immutable — no UPDATE/DELETE).
GRANT SELECT, INSERT ON public.platform_contact_logs TO app_platform_admin;
--> statement-breakpoint
-- Follow-ups: SELECT + INSERT, and COLUMN-LEVEL UPDATE on ONLY the mutable
-- fields (status transitions, assignment, reschedule, resolution stamps). This
-- makes workspace_id / title / note / created_by / created_at un-updatable at
-- the database level even if application code regressed. No DELETE.
GRANT SELECT, INSERT ON public.platform_follow_ups TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("status", "assigned_to_user_id", "due_at", "resolved_at", "resolved_by_user_id")
  ON public.platform_follow_ups TO app_platform_admin;
--> statement-breakpoint
-- Audit trail: SELECT + INSERT only (append-only — no UPDATE/DELETE, so an
-- audit row can never be altered or erased by the console role).
GRANT SELECT, INSERT ON public.platform_audit_events TO app_platform_admin;

-- ============================================================================
-- OUT-OF-BAND role assignment — DO NOT run as part of this migration.
-- After preflight, review the MASKED list of current platform_admins, then run
-- ONE explicit statement per account, with each user's id substituted (no id is
-- hardcoded here). Everyone not named below stays SUPPORT_AGENT.
--
--   -- the single founder:
--   UPDATE platform_admins SET role = 'PLATFORM_OWNER' WHERE user_id = '<FOUNDER_USER_ID>';
--   -- each real partner:
--   UPDATE platform_admins SET role = 'OPERATIONS_ADMIN' WHERE user_id = '<PARTNER_USER_ID>';
--
-- Anything old/test remains SUPPORT_AGENT (or is removed later per decision).
-- ============================================================================
