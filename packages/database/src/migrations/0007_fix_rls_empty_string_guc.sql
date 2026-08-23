-- RLS Security Delta — fix: PostgreSQL custom GUC "placeholder" quirk.
--
-- BUG: once a custom session variable like `app.workspace_id` has been set
-- via `set_config(..., true)` ("SET LOCAL") ANYWHERE on a physical
-- connection, PostgreSQL registers a session-level "placeholder" entry for
-- that name. When the transaction that set it ends, the value resets — but
-- to an EMPTY STRING, not to "unset" (NULL) — because the placeholder now
-- exists. `current_setting(name, true)` ("missing_ok") only returns NULL
-- for a name that has NEVER been touched in the session at all; once a
-- placeholder exists, it returns '' instead. Since connection pools
-- (postgres.js's client pool, and Supabase's Session Pooler) reuse
-- physical connections across logically-unrelated transactions/requests,
-- ANY later transaction on that same physical connection which does NOT
-- itself set `app.workspace_id` (e.g. GET /me's cross-workspace self-read,
-- which only sets `app.user_id`) would see '' rather than NULL, and
-- `''::uuid` throws `invalid input syntax for type uuid`, breaking a
-- perfectly legitimate request with a 500.
--
-- FIX: wrap every `current_setting('app.*', true)` read in these policies
-- with `NULLIF(..., '')` so an empty-string placeholder is normalized to
-- NULL before the `::uuid` cast — matching the originally-intended
-- semantics ("no workspace/user context set" behaves identically whether
-- the GUC was never touched or was reset to its post-transaction
-- placeholder default). This does not change behavior for the normal case
-- where a real value is set — NULLIF is a no-op there.
--> statement-breakpoint
ALTER POLICY "workspaces_tenant_isolation" ON "workspaces"
  USING (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER POLICY "memberships_tenant_isolation" ON "memberships"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER POLICY "permission_grants_tenant_isolation" ON "permission_grants"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER POLICY "permission_group_scopes_tenant_isolation" ON "permission_group_scopes"
  USING (
    EXISTS (
      SELECT 1 FROM permission_grants pg
      WHERE pg.id = permission_group_scopes.permission_grant_id
        AND pg.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM permission_grants pg
      WHERE pg.id = permission_group_scopes.permission_grant_id
        AND pg.workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    )
  );
--> statement-breakpoint
ALTER POLICY "audit_events_tenant_isolation" ON "audit_events"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER POLICY "memberships_self_read" ON "memberships"
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
ALTER POLICY "workspaces_self_membership_read" ON "workspaces"
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.workspace_id = workspaces.id
        AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    )
  );
