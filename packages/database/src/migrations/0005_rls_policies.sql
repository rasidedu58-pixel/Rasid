-- Phase 2 — Row Level Security (defense-in-depth), Technical Architecture
-- §6 and Database Schema §16. Hand-written (RLS is not expressible in the
-- Drizzle TS schema DSL used for drizzle-kit generate/diff), following the
-- ADR-017 tenant-isolation strategy.
--
-- IMPORTANT: application-level authorization (SupabaseAuthGuard +
-- PermissionGuard in apps/api) remains the actual authority. RLS here is a
-- second, independent line of defense in case an application-layer check is
-- ever missed — it must never be relied upon as the only check.
--
-- Mechanism: the API sets `app.workspace_id` for the duration of a
-- transaction via `SET LOCAL app.workspace_id = '<uuid>'` (see
-- packages/database/src/connection.ts `withWorkspaceScope`). A connection
-- that never sets it (e.g. a service-role/migration connection, or a
-- request that only touches non-workspace-scoped tables) is unaffected by
-- these policies unless it queries a workspace-scoped table directly.
--
-- NOTE: this migration only adds infrastructure (RLS policies + the SET
-- LOCAL helper). Phase 1's existing call sites (createUserWorkspaceMembership,
-- listMembershipsForUser, findMembership, completeOnboarding) do NOT set
-- app.workspace_id yet and are NOT modified by this migration — see the
-- Phase 2 handoff notes (RLS section) for why this is an explicit,
-- documented decision rather than a silent gap.
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permission_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permission_group_scopes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- `workspaces` is the tenant root itself: its own `id` is the tenant key.
CREATE POLICY "workspaces_tenant_isolation" ON "workspaces"
  USING (id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
CREATE POLICY "permission_grants_tenant_isolation" ON "permission_grants"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
-- `permission_group_scopes` has no workspace_id column (Database Schema
-- §4.5 defines only id/permission_grant_id/group_id/created_at — exact, not
-- extended here). Its tenant key is derived via its parent grant.
CREATE POLICY "permission_group_scopes_tenant_isolation" ON "permission_group_scopes"
  USING (
    EXISTS (
      SELECT 1 FROM "permission_grants" pg
      WHERE pg.id = "permission_group_scopes".permission_grant_id
        AND pg.workspace_id = current_setting('app.workspace_id', true)::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY "audit_events_tenant_isolation" ON "audit_events"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
-- `users` is a global identity table, not workspace-scoped — intentionally
-- left without RLS/tenant policy (unchanged from Phase 1).
