-- 0052 — Pre-launch hardening: enable RLS on `users` with self-scope policies.
--
-- `users` is the only one of the five platform-admin-readable identity tables
-- (workspaces / memberships / subscriptions / entitlements / users) that never
-- had `ENABLE ROW LEVEL SECURITY`. Its four siblings all do, and 0048 added a
-- `users_platform_admin_read` policy to `users` as if it were RLS-governed too
-- — but with RLS disabled that policy is inert and, more importantly, the
-- identity/PII table (`email_display`, `full_name`) has app_runtime
-- SELECT/INSERT/UPDATE grants with NO RLS backstop. This migration closes that
-- gap so the identity schema is internally consistent and defence-in-depth
-- covers the PII table.
--
-- PROVEN BACKWARD-COMPATIBLE (repo audit, pre-launch security review):
--   * Every app_runtime access to `users` lives in identity.repository.ts and
--     is already self-scoped: findUserByAuthId / loadProvisionedIdentity /
--     loadUserWithMemberships all `WHERE users.id = <verified auth id>`, and
--     createUserWorkspaceMembership INSERTs `id = <verified auth id>` — i.e.
--     exactly `id = app.user_id`, which `withRuntimeContext` SETs on every
--     request (and during first-request provisioning). These satisfy the
--     policies below unchanged.
--   * No app_runtime query joins `users` for OTHER users (the team listing
--     reads `memberships` only). Cross-user reads happen exclusively over the
--     dedicated `app_platform_admin` connection, which is served by the
--     existing `users_platform_admin_read` (USING true) policy — now effective.
--   * `app_runtime` also holds an UPDATE grant, but NO code path updates
--     `users` today; deliberately NO self-update policy is added (unproven
--     flow), so any future app_runtime UPDATE fails closed under RLS until a
--     proven policy is added — strictly safer than the current no-RLS state.
--
-- Same empty-string-safe GUC pattern as `memberships_self_read` (0006/0007):
-- `NULLIF(current_setting('app.user_id', true), '')::uuid`.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "users_self_read" ON "users"
  FOR SELECT
  TO app_runtime
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "users_self_insert" ON "users"
  FOR INSERT
  TO app_runtime
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
