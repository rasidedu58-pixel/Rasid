-- Platform Administration — Customer & Subscription Controls.
--
-- Grants the platform-ops role (app_platform_admin) the NARROW tenant WRITE
-- access these controls need — the first time it writes tenant data at all:
--   * workspaces: UPDATE (status, archived_at, name) — suspend/reactivate + edit
--   * users:      UPDATE (full_name, phone)         — edit customer contact
--   * subscriptions / entitlements / audit_events / outbox_events: the exact
--     write set of the REUSED updateSubscriptionStateTransaction (trial extend,
--     set end date, suspend, reactivate) — no bespoke billing logic.
-- Each table already has a FOR SELECT platform-admin policy (0048/0055/0057);
-- this adds the matching write policy. Column-level grants keep the surface
-- minimal (e.g. a customer's owner_user_id / created_at stay un-writable).
--
-- NOT auto-applied to Production — apply via the safe preflight. Additive.

-- workspaces: suspend/reactivate + rename ---------------------------------------
CREATE POLICY "workspaces_platform_admin_write" ON "workspaces"
  FOR UPDATE TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT UPDATE ("status", "archived_at", "name") ON public.workspaces TO app_platform_admin;
--> statement-breakpoint

-- users: edit customer contact -------------------------------------------------
CREATE POLICY "users_platform_admin_write" ON "users"
  FOR UPDATE TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT UPDATE ("full_name", "phone") ON public.users TO app_platform_admin;
--> statement-breakpoint

-- subscriptions: trial/subscription state transitions --------------------------
CREATE POLICY "subscriptions_platform_admin_write" ON "subscriptions"
  FOR UPDATE TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT UPDATE ON public.subscriptions TO app_platform_admin;
--> statement-breakpoint

-- entitlements: the recomputed snapshot rows (close + insert) ------------------
CREATE POLICY "entitlements_platform_admin_insert" ON "entitlements"
  FOR INSERT TO app_platform_admin WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "entitlements_platform_admin_update" ON "entitlements"
  FOR UPDATE TO app_platform_admin USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT INSERT, UPDATE ON public.entitlements TO app_platform_admin;
--> statement-breakpoint

-- audit_events: the tenant-side subscription audit row ------------------------
CREATE POLICY "audit_events_platform_admin_insert" ON "audit_events"
  FOR INSERT TO app_platform_admin WITH CHECK (true);
--> statement-breakpoint
GRANT INSERT ON public.audit_events TO app_platform_admin;
--> statement-breakpoint

-- outbox_events: the subscription state-change event ---------------------------
CREATE POLICY "outbox_events_platform_admin_insert" ON "outbox_events"
  FOR INSERT TO app_platform_admin WITH CHECK (true);
--> statement-breakpoint
GRANT INSERT ON public.outbox_events TO app_platform_admin;
