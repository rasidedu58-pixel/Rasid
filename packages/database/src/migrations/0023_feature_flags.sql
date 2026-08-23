-- Phase 5 Closure Delta — feature_flags (Database Schema §21's illustrative
-- 0020_seed_feature_flags_and_defaults, pulled forward). Global (no
-- workspace_id) product-policy toggles; app_runtime gets SELECT only — no
-- management endpoint exists yet to change a value.
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "feature_flags" ("key", "enabled", "description") VALUES
	('complete_session_with_missing_records', false, 'PRD §34 — allow Session completion despite missing required attendance/homework records (gaps remain visible in Missing Records; audited).');
--> statement-breakpoint
GRANT SELECT ON public.feature_flags TO app_runtime;
