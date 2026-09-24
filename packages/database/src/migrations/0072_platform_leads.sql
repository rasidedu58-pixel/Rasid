-- Platform Leads — Phase 16 Part B (Customer / lead follow-up for Platform Admin).
--
-- Every NEW self-service signup (a brand-new Owner + Workspace) becomes a
-- lead in a Platform-Admin-only surface so the Rasid team can follow up
-- (contact, schedule a call back, mark converted). This is intentionally a
-- SMALL follow-up ledger, NOT a full CRM.
--
-- Access model — identical to the other PLATFORM tables (platform_admins,
-- platform_contact_logs, platform_follow_ups, platform_audit_events): this is
-- NOT tenant data, so it carries NO row-level-security policy; access is
-- governed purely by GRANT. Two roles touch it, each with the minimum needed:
--   * app_runtime         — INSERT only. The signup/provisioning path (which
--                           runs as app_runtime) creates exactly one lead the
--                           moment a new owner workspace is created. It never
--                           reads or edits leads.
--   * app_platform_admin  — SELECT + UPDATE (the console lists leads and edits
--                           status / follow-up date / note). It also gets
--                           INSERT for parity/testing, but the product creates
--                           leads only via the runtime signup hook.
--
-- Owner decisions baked in (Phase 16 Part B approval):
--   * NO backfill of existing workspaces — this migration creates the table
--     only; leads accrue from new signups AFTER this ships.
--   * NO PII copied here — name / phone / email are read live from users via
--     owner_user_id at query time; this table stores only the follow-up state.
--   * updated_by is nullable — the first row is System-generated (no admin
--     actor); it is set only once a human admin edits the lead.
--   * CONVERTED stays a MANUAL status in V1 — an active paid subscription is a
--     hint shown in the UI, never an automatic trigger that flips this column.
--
-- Deliberately NOT auto-applied to Production — apply via the same safe
-- preflight used for every other platform migration. Additive and reversible.

CREATE TABLE IF NOT EXISTS "platform_leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- One lead per workspace. The UNIQUE constraint is also the idempotency
  -- guard for the signup hook (ON CONFLICT DO NOTHING) so a retried / racing
  -- provision never creates a duplicate lead.
  "workspace_id" uuid NOT NULL UNIQUE,
  "owner_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'NEW',
  "last_contact_at" timestamptz,
  "next_follow_up_at" timestamptz,
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- Nullable on purpose: the row is born System-generated (no admin actor);
  -- set only when a human platform admin edits the lead.
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "platform_leads_status_check"
    CHECK ("status" IN ('NEW', 'CONTACTED', 'FOLLOW_UP', 'POSTPONED', 'CONVERTED', 'NOT_INTERESTED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_leads_status_idx" ON "platform_leads" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_leads_next_follow_up_idx" ON "platform_leads" ("next_follow_up_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_leads_created_at_idx" ON "platform_leads" ("created_at");
--> statement-breakpoint

-- Runtime signup hook: INSERT only (least privilege — never reads/edits).
GRANT INSERT ON public.platform_leads TO app_runtime;
--> statement-breakpoint
-- Platform Admin console: read + follow-up edits (+ INSERT for parity/tests).
GRANT SELECT, INSERT ON public.platform_leads TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("status", "last_contact_at", "next_follow_up_at", "note", "updated_at", "updated_by")
  ON public.platform_leads TO app_platform_admin;
