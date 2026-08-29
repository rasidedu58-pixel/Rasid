-- 0053 — Team & Permissions: let an ACTIVE member read the BASIC identity of
-- co-members in the SAME workspace.
--
-- 0052 locked `users` to self-scope (id = app.user_id), which by design made
-- the team listing identity-free (`GET /team` reads `memberships` only). The
-- Team & Permissions module needs the workspace owner to see WHO is on their
-- team (full_name / email_display / phone). This policy adds exactly that,
-- and nothing more.
--
-- Why this is safe / tightly scoped:
--   * ADDITIVE — RLS SELECT policies are OR'd, so `users_self_read` and
--     `users_platform_admin_read` are unchanged; this only GRANTS additional
--     visibility, never removes any.
--   * WORKSPACE-SCOPED BY CONSTRUCTION — the `memberships` rows this policy
--     reads are themselves RLS-restricted to
--     `current_setting('app.workspace_id')` (memberships_tenant_isolation),
--     so it can only ever expose identity of members of the workspace
--     currently in context, to a caller who is an ACTIVE member of that same
--     workspace. There is no cross-workspace leakage.
--   * READ-ONLY — SELECT only; no INSERT/UPDATE/DELETE is affected.
--
-- Rollback (safe, no data change):
--   DROP POLICY "users_workspace_comember_read" ON "users";
CREATE POLICY "users_workspace_comember_read" ON "users"
  FOR SELECT
  TO app_runtime
  USING (
    EXISTS (
      SELECT 1
      FROM "memberships" m_self
      JOIN "memberships" m_target
        ON m_target.workspace_id = m_self.workspace_id
      WHERE m_self.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND m_self.status = 'ACTIVE'
        AND m_target.user_id = "users".id
    )
  );
