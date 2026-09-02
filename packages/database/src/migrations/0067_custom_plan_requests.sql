-- Billing Engine — Phase 5. custom_plan_requests: a customer's LEAD for a
-- negotiated CUSTOM plan (active students > 3000, the standard ceiling). The
-- customer supplies only desired capacities + cycle + an optional note; the
-- server stores an INTERNAL, admin-only recommendation snapshot for reference.
-- No price/limit is customer-authorable. Resolved by a platform admin creating
-- a custom_plan_offers row (0068).
--
-- RLS/grants (least privilege): app_runtime (owner) SELECT own + INSERT own +
-- cancel own PENDING_REVIEW (UPDATE status only). app_platform_admin SELECT all
-- + manage status. No DELETE for anyone. At most ONE PENDING_REVIEW per workspace.
--
-- APPLY on a disposable/staging DB (with 0062-0066) before deploy. NOT
-- auto-applied to Production.

CREATE TABLE IF NOT EXISTS "custom_plan_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "requested_by_user_id" uuid NOT NULL,
  "requested_max_active_students" integer NOT NULL,
  "requested_max_team_members" integer NOT NULL,
  "preferred_billing_cycle" text NOT NULL,
  "customer_note" text,
  "recommended_price_minor" bigint NOT NULL,
  "recommended_max_team_members" integer NOT NULL,
  "recommendation_version" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING_REVIEW',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "custom_plan_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict,
  CONSTRAINT "custom_plan_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "custom_plan_requests_students_above_standard_check" CHECK ("requested_max_active_students" > 3000),
  CONSTRAINT "custom_plan_requests_team_nonnegative_check" CHECK ("requested_max_team_members" >= 0),
  CONSTRAINT "custom_plan_requests_billing_cycle_check" CHECK ("preferred_billing_cycle" IN ('MONTHLY', 'ANNUAL')),
  CONSTRAINT "custom_plan_requests_status_check" CHECK ("status" IN ('PENDING_REVIEW', 'OFFERED', 'CANCELLED', 'CLOSED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "custom_plan_requests_workspace_status_idx" ON "custom_plan_requests" ("workspace_id", "status", "created_at");
--> statement-breakpoint
-- At most one open request per workspace (anti-spam; deterministic duplicate handling).
CREATE UNIQUE INDEX IF NOT EXISTS "custom_plan_requests_one_open_per_workspace" ON "custom_plan_requests" ("workspace_id") WHERE "status" = 'PENDING_REVIEW';
--> statement-breakpoint
ALTER TABLE "custom_plan_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "custom_plan_requests_tenant_read" ON "custom_plan_requests"
  FOR SELECT TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "custom_plan_requests_tenant_insert" ON "custom_plan_requests"
  FOR INSERT TO app_runtime
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Owner may ONLY cancel its own PENDING_REVIEW request.
CREATE POLICY "custom_plan_requests_tenant_cancel" ON "custom_plan_requests"
  FOR UPDATE TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid AND status = 'PENDING_REVIEW')
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid AND status = 'CANCELLED');
--> statement-breakpoint
GRANT SELECT, INSERT ON public.custom_plan_requests TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("status", "updated_at", "version") ON public.custom_plan_requests TO app_runtime;
--> statement-breakpoint
CREATE POLICY "custom_plan_requests_platform_admin_read" ON "custom_plan_requests"
  FOR SELECT TO app_platform_admin USING (true);
--> statement-breakpoint
CREATE POLICY "custom_plan_requests_platform_admin_manage" ON "custom_plan_requests"
  FOR UPDATE TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON public.custom_plan_requests TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("status", "updated_at", "version") ON public.custom_plan_requests TO app_platform_admin;
