-- Phase 8 — owner_trial_grants: a minimal, NOT tenant-scoped anti-abuse
-- ledger, not part of the approved §10 column list — see
-- schema/subscriptions.ts's own doc comment for the full rationale (PRD
-- §44.2's own "Anti-abuse boundary" row anticipates exactly this: "one
-- ordinary trial per WORKSPACE OWNER", and the only existing workspace-
-- creation path is keyed to a Supabase auth user id, which cannot by
-- itself stop the same person from getting a second free trial via
-- delete-account-and-recreate). Stores only a SHA-256 hash of the
-- normalized signup email — never the raw email — to minimize PII
-- exposure in a table that is deliberately global (see 0037 for why it
-- carries no RLS policy).
--> statement-breakpoint
CREATE TABLE "owner_trial_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" text NOT NULL,
	"first_user_id" uuid NOT NULL,
	"first_workspace_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_trial_grants_email_hash_unique" UNIQUE("email_hash")
);
--> statement-breakpoint
ALTER TABLE "owner_trial_grants" ADD CONSTRAINT "owner_trial_grants_first_user_id_users_id_fk" FOREIGN KEY ("first_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "owner_trial_grants" ADD CONSTRAINT "owner_trial_grants_first_workspace_id_workspaces_id_fk" FOREIGN KEY ("first_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;
