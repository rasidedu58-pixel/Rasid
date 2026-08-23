-- Phase 8 — entitlements (Database Schema §10.2), exactly as approved.
-- Append-only history: every recompute INSERTs a fresh row per capability
-- rather than updating an existing one; "current" = the row with the
-- latest effective_from per (workspace_id, capability). V1 keeps exactly
-- the 4 named capability keys (CORE_OPERATIONS/CREATE_MONTH/
-- TEAM_MANAGEMENT/REPORT_EXPORT) — no HISTORICAL_READ/BILLING_ACCESS keys
-- (explicit correction: historical reads and billing endpoints are gated
-- by ordinary Permission/Scope only, never by Entitlement).
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"state" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_capability_check" CHECK ("entitlements"."capability" IN ('CORE_OPERATIONS', 'CREATE_MONTH', 'TEAM_MANAGEMENT', 'REPORT_EXPORT')),
	CONSTRAINT "entitlements_state_check" CHECK ("entitlements"."state" IN ('ALLOWED', 'BLOCKED')),
	CONSTRAINT "entitlements_source_type_check" CHECK ("entitlements"."source_type" IN ('SUBSCRIPTION', 'TRIAL', 'ADMIN'))
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "entitlements_workspace_capability_effective_from_idx" ON "entitlements" USING btree ("workspace_id","capability","effective_from");
