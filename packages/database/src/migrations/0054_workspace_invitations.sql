-- 0054 — Team & Permissions Phase 2: invitation-link flow (workspace_invitations).
--
-- A pending invitation cannot be a `memberships` row (memberships.user_id is
-- NOT NULL with a FK to users, and the invitee may not have an account yet),
-- so invites live here until accepted. On acceptance a real ACTIVE membership
-- is created and this row flips to ACCEPTED — atomically, in ONE transaction
-- (see invitations.repository.ts `acceptInvitation`).
--
-- SECURITY MODEL
--   * `token_hash` stores a SHA-256 hex digest ONLY — the raw token is never
--     persisted and never logged; it is returned to the owner exactly once,
--     mirroring `qr_credentials`. Lookups are always exact-hash on a
--     high-entropy digest, so there is no enumeration surface.
--   * RLS (defense-in-depth; app authz remains the authority):
--       - management reads/writes are tenant-scoped to app.workspace_id
--         (owner lists/creates/revokes within their own workspace only);
--       - the accept path reads the invite by a transaction-scoped
--         `app.invite_token_hash` GUC BEFORE any workspace context exists
--         (the invitee is not yet a member) — same GUC-keyed-policy pattern
--         as `users_self_read` (0052), empty-string-safe per 0007.
--   * No DELETE grant — status transitions only (PENDING → ACCEPTED/REVOKED),
--     consistent with the soft-mutation rule in 0006.
--
-- Rollback (safe, no data loss beyond the feature's own rows):
--   DROP TABLE "workspace_invitations";
CREATE TABLE "workspace_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE restrict,
  "token_hash" text NOT NULL,
  "role_label" text NOT NULL,
  "desired_grants" jsonb NOT NULL,
  "invited_label" text,
  "status" text NOT NULL DEFAULT 'PENDING',
  "invited_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "accepted_by_user_id" uuid REFERENCES "users"("id") ON DELETE restrict,
  "accepted_membership_id" uuid,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "workspace_invitations_status_check" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'REVOKED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitations_token_hash_unique" ON "workspace_invitations" ("token_hash");
--> statement-breakpoint
CREATE INDEX "workspace_invitations_workspace_status_idx" ON "workspace_invitations" ("workspace_id", "status");
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Least-privilege grants — no DELETE (soft status transitions only).
GRANT SELECT, INSERT, UPDATE ON public.workspace_invitations TO app_runtime;
--> statement-breakpoint
-- Belt-and-suspenders: 0006 already flipped default privileges, but revoke
-- explicitly in case this table is created in an environment predating that.
REVOKE ALL ON public.workspace_invitations FROM anon;
--> statement-breakpoint
REVOKE ALL ON public.workspace_invitations FROM authenticated;
--> statement-breakpoint
-- Management (owner) — tenant-scoped to the workspace currently in context.
CREATE POLICY "workspace_invitations_tenant_select" ON "workspace_invitations"
  FOR SELECT
  TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workspace_invitations_tenant_insert" ON "workspace_invitations"
  FOR INSERT
  TO app_runtime
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "workspace_invitations_tenant_update" ON "workspace_invitations"
  FOR UPDATE
  TO app_runtime
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Accept path — the invitee is authenticated but NOT yet a member, so no
-- workspace context is set when the invite is first read. This ADDITIONAL
-- permissive SELECT policy (OR-combined with the tenant policy above) admits
-- exactly the one row whose token_hash matches the transaction-scoped
-- `app.invite_token_hash` GUC. Empty-string-safe: an unset GUC yields NULL,
-- and `token_hash = NULL` is never true (fail-closed).
CREATE POLICY "workspace_invitations_token_select" ON "workspace_invitations"
  FOR SELECT
  TO app_runtime
  USING (token_hash = NULLIF(current_setting('app.invite_token_hash', true), ''));
