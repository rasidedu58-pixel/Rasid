-- Phase 8 — RLS + least-privilege app_runtime grants for the 3 new tables.
-- Same ADR-017 tenant-isolation pattern as every prior phase, with two
-- deliberate departures documented below.
--
-- `subscriptions`: SELECT, INSERT, UPDATE (no DELETE) — this is a single
-- evolving row per workspace, transitioned in place through its state
-- machine (webhook processing, scheduled expiry check), unlike every
-- append-only table added in Phases 5-7. Getting this grant wrong (making
-- it append-only) would make the state machine itself impossible to
-- implement without inventing a workaround.
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.subscriptions TO app_runtime;
--> statement-breakpoint
-- `entitlements`: append-only (SELECT, INSERT only) — every recompute
-- inserts a fresh row per capability rather than mutating an existing one
-- (see schema/subscriptions.ts's own comment); "current" is derived at
-- read time by latest effective_from, so no UPDATE is ever needed.
ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "entitlements_tenant_isolation" ON "entitlements"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON public.entitlements TO app_runtime;
--> statement-breakpoint
-- `owner_trial_grants`: DELIBERATELY NO RLS POLICY. This table is not
-- tenant-partitioned data — its entire purpose is a CROSS-workspace,
-- cross-identity anti-abuse lookup (has this verified email already
-- consumed the one ordinary trial, regardless of which — possibly since-
-- deleted — workspace/user it was originally granted under?). A tenant-
-- isolation policy keyed on `app.workspace_id` would defeat that purpose
-- outright: during provisioning of a BRAND NEW workspace, `app.workspace_id`
-- is necessarily the new (not-yet-existing-in-this-table) workspace's own
-- id, so a same-workspace-only policy could never see a PRIOR grant row
-- belonging to a different workspace — exactly the abuse case this table
-- exists to catch. Only a SHA-256 hash of the normalized email is stored
-- (never the raw email), which bounds the privacy/security cost of this
-- global visibility. No DELETE/UPDATE grant either way — the table is
-- pure insert-once-per-identity.
GRANT SELECT, INSERT ON public.owner_trial_grants TO app_runtime;
