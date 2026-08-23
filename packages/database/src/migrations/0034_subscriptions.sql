-- Phase 8 — subscriptions (Database Schema §10.1), exactly as approved.
-- One commercial record per workspace, UPDATED IN PLACE through its state
-- machine (version-checked optimistic concurrency) — NOT an append-only
-- ledger, unlike entitlements/attention_evidence/contact_logs. Hand-written
-- (not drizzle-kit generate output) to match this package's established
-- convention of hand-authoring every migration past the earliest phases.
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text DEFAULT 'PADDLE' NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"state" text DEFAULT 'TRIAL' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "subscriptions_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "subscriptions_provider_subscription_id_unique" UNIQUE("provider_subscription_id"),
	CONSTRAINT "subscriptions_state_check" CHECK ("subscriptions"."state" IN ('TRIAL', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED_AT_PERIOD_END'))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "subscriptions_state_period_end_idx" ON "subscriptions" USING btree ("state","period_end");
