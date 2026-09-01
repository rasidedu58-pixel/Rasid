/**
 * Team & Permissions Phase 2 — invitation-link real-Postgres integration tests.
 *
 * Mirrors `./finance-security.integration.test.ts` exactly: two real
 * connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL` app_runtime),
 * imports the COMPILED package entry point (`../dist/index.js`), and
 * self-skips when live credentials + a prior build aren't available.
 *
 * Requires migration 0054 (workspace_invitations) already applied against the
 * target database.
 *
 * Proves the security guarantees the feature was designed around:
 *   - token-hash read isolation (only the correct `app.invite_token_hash`
 *     GUC reveals the row; no workspace context, no wrong token);
 *   - cross-workspace tenant isolation for owner management;
 *   - no DELETE grant (soft status transitions only);
 *   - atomic accept creates membership + grants + flips status in one unit;
 *   - single-use: a second accept (sequential OR concurrent) fails closed
 *     with NO duplicate membership;
 *   - expired / revoked invitations fail closed;
 *   - the raw token is never stored (only its SHA-256 hash).
 */
import { existsSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvitationTx,
  closeDb,
  createInvitation,
  findInvitationByTokenHashTx,
  revokeInvitation,
  withRuntimeContext,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);

const hasLiveCreds =
  !!DATABASE_URL && !!MIGRATION_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[invitations-security.integration.test] Skipping: requires DATABASE_URL (app_runtime) and " +
      "MIGRATION_DATABASE_URL (postgres) set to distinct connection strings, AND this package " +
      "already built (dist/index.js must exist), AND migration 0054 applied. Expected to skip in " +
      "CI / sandboxes without live Supabase credentials — this is not a failure.",
  );
}

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");
const rawToken = () => randomBytes(32).toString("base64url");

describe.skipIf(!hasLiveCreds)("Phase 2 Invitations Security (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const ownerAId = randomUUID();
  const ownerBId = randomUUID();
  const inviteeCId = randomUUID(); // sequential-accept invitee
  const inviteeDId = randomUUID(); // concurrent-accept invitee
  const membershipAId = randomUUID();
  const membershipBId = randomUUID();
  const groupAId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${ownerAId}, 'Invite Owner A', 'invite-owner-a@example.test', 'ACTIVE'),
      (${ownerBId}, 'Invite Owner B', 'invite-owner-b@example.test', 'ACTIVE'),
      (${inviteeCId}, 'Invitee C', 'invitee-c@example.test', 'ACTIVE'),
      (${inviteeDId}, 'Invitee D', 'invitee-d@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${ownerAId}, 'Invite Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${ownerBId}, 'Invite Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${membershipAId}, ${workspaceAId}, ${ownerAId}, 'OWNER', 'ACTIVE', now()),
      (${membershipBId}, ${workspaceBId}, ${ownerBId}, 'OWNER', 'ACTIVE', now())`;

    // Billing Phase 2 — invitation-accept now takes the workspace subscription
    // row lock for the team-capacity check, so the fixture must provide one.
    // This suite proves invitation security, not capacity, so it seeds an ACTIVE
    // CUSTOM plan with an effectively unbounded team limit (catalog test data —
    // the production resolver is fixed and non-injectable). Requires migration
    // 0062 (plan_code / custom_* columns) applied to the target DB.
    await admin`INSERT INTO subscriptions (workspace_id, state, plan_code, custom_max_active_students, custom_max_team_members) VALUES
      (${workspaceAId}, 'ACTIVE', 'CUSTOM', 1000000, 1000000),
      (${workspaceBId}, 'ACTIVE', 'CUSTOM', 1000000, 1000000)`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupAId}, ${workspaceAId}, 'Invite Test Group A', 'ACTIVE')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM audit_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM permission_group_scopes WHERE group_id IN (${groupAId})`;
      await admin`DELETE FROM permission_grants WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM workspace_invitations WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM groups WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM subscriptions WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM memberships WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${ownerAId}, ${ownerBId}, ${inviteeCId}, ${inviteeDId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  /** Helper — create a PENDING invite for workspace A via the real repo path. */
  async function seedInvite(opts?: { expiresAt?: Date; selectedGroup?: boolean }) {
    const raw = rawToken();
    const desiredGrants = opts?.selectedGroup
      ? [{ permissionKey: "groups.view", scopeType: "SELECTED_GROUPS" as const, groupIds: [groupAId] }]
      : [{ permissionKey: "students.view_basic", scopeType: "ALL_GROUPS" as const }];
    const invite = await withRuntimeContext({ userId: ownerAId, workspaceId: workspaceAId }, (db) =>
      createInvitation(db, {
        workspaceId: workspaceAId,
        tokenHash: hash(raw),
        roleLabel: "MEMBER",
        desiredGrants,
        invitedLabel: null,
        invitedByUserId: ownerAId,
        expiresAt: opts?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
    return { raw, invite };
  }

  it("1. the raw token is never stored — only its SHA-256 hash", async () => {
    const { raw, invite } = await seedInvite();
    const [row] = await admin`SELECT token_hash FROM workspace_invitations WHERE id = ${invite.id}`;
    expect(row?.token_hash).toBe(hash(raw));
    expect(row?.token_hash).not.toBe(raw);
  });

  it("2. token-hash read isolation — only the correct token GUC reveals the row", async () => {
    const { raw, invite } = await seedInvite();

    // Correct token → visible under the invitee's user context (no workspace).
    const found = await withRuntimeContext({ userId: inviteeCId }, (db) => findInvitationByTokenHashTx(db, hash(raw)));
    expect(found?.id).toBe(invite.id);

    // Wrong token hash → nothing.
    const wrong = await withRuntimeContext({ userId: inviteeCId }, (db) => findInvitationByTokenHashTx(db, hash(rawToken())));
    expect(wrong).toBeUndefined();

    // No token GUC and no workspace context → RLS reveals nothing by id.
    const blind = await withRuntimeContext({ userId: inviteeCId }, (db) =>
      db.execute(sql`SELECT id FROM workspace_invitations WHERE id = ${invite.id}`),
    );
    expect(blind).toHaveLength(0);
  });

  it("3. cross-workspace tenant isolation for management reads", async () => {
    const { invite } = await seedInvite();

    const foreign = await withRuntimeContext({ userId: ownerBId, workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT id FROM workspace_invitations WHERE id = ${invite.id}`),
    );
    expect(foreign).toHaveLength(0);

    const own = await withRuntimeContext({ userId: ownerAId, workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT id FROM workspace_invitations WHERE id = ${invite.id}`),
    );
    expect(own).toHaveLength(1);
  });

  it("4. app_runtime has no DELETE grant on workspace_invitations", async () => {
    const { invite } = await seedInvite();
    await expect(
      withRuntimeContext({ userId: ownerAId, workspaceId: workspaceAId }, (db) =>
        db.execute(sql`DELETE FROM workspace_invitations WHERE id = ${invite.id}`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("5. atomic accept creates an ACTIVE membership + grants and flips the invite to ACCEPTED", async () => {
    const { raw, invite } = await seedInvite({ selectedGroup: true });

    const result = await withRuntimeContext({ userId: inviteeCId }, (db) =>
      acceptInvitationTx(db, { tokenHash: hash(raw), accepterUserId: inviteeCId }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [membership] = await admin`SELECT status, role_label FROM memberships WHERE id = ${result.membershipId}`;
    expect(membership?.status).toBe("ACTIVE");
    expect(membership?.role_label).toBe("MEMBER");

    const grants = await admin`SELECT permission_key, scope_type FROM permission_grants WHERE membership_id = ${result.membershipId} AND revoked_at IS NULL`;
    expect(grants).toHaveLength(1);
    expect(grants[0]?.permission_key).toBe("groups.view");
    expect(grants[0]?.scope_type).toBe("SELECTED_GROUPS");

    const scopes = await admin`SELECT group_id FROM permission_group_scopes pgs
      JOIN permission_grants pg ON pg.id = pgs.permission_grant_id
      WHERE pg.membership_id = ${result.membershipId}`;
    expect(scopes.map((s) => s.group_id)).toContain(groupAId);

    const [updated] = await admin`SELECT status, accepted_by_user_id, accepted_membership_id FROM workspace_invitations WHERE id = ${invite.id}`;
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.accepted_by_user_id).toBe(inviteeCId);
    expect(updated?.accepted_membership_id).toBe(result.membershipId);
  });

  it("6. single-use — a second accept of the same (now-accepted) invite fails closed with no duplicate membership", async () => {
    // inviteeC already accepted in test 5; re-accepting the same token must fail.
    const [prior] = await admin`SELECT token_hash FROM workspace_invitations WHERE accepted_by_user_id = ${inviteeCId} LIMIT 1`;
    const second = await withRuntimeContext({ userId: inviteeCId }, (db) =>
      acceptInvitationTx(db, { tokenHash: prior!.token_hash as string, accepterUserId: inviteeCId }),
    );
    expect(second.ok).toBe(false);

    const memberships = await admin`SELECT id FROM memberships WHERE workspace_id = ${workspaceAId} AND user_id = ${inviteeCId}`;
    expect(memberships).toHaveLength(1);
  });

  it("7. concurrent double-accept — exactly one wins, exactly one membership is created", async () => {
    const { raw } = await seedInvite();
    const tokenHash = hash(raw);

    const [r1, r2] = await Promise.all([
      withRuntimeContext({ userId: inviteeDId }, (db) => acceptInvitationTx(db, { tokenHash, accepterUserId: inviteeDId })),
      withRuntimeContext({ userId: inviteeDId }, (db) => acceptInvitationTx(db, { tokenHash, accepterUserId: inviteeDId })),
    ]);

    const okCount = [r1, r2].filter((r) => r.ok).length;
    expect(okCount).toBe(1);

    const memberships = await admin`SELECT id FROM memberships WHERE workspace_id = ${workspaceAId} AND user_id = ${inviteeDId}`;
    expect(memberships).toHaveLength(1);
  });

  it("8. expired invitation fails closed — no membership created", async () => {
    const expiredUser = randomUUID();
    await admin`INSERT INTO users (id, full_name, status) VALUES (${expiredUser}, 'Expired Invitee', 'ACTIVE')`;
    try {
      const { raw } = await seedInvite({ expiresAt: new Date(Date.now() - 60_000) });
      const result = await withRuntimeContext({ userId: expiredUser }, (db) =>
        acceptInvitationTx(db, { tokenHash: hash(raw), accepterUserId: expiredUser }),
      );
      expect(result.ok).toBe(false);
      const memberships = await admin`SELECT id FROM memberships WHERE workspace_id = ${workspaceAId} AND user_id = ${expiredUser}`;
      expect(memberships).toHaveLength(0);
    } finally {
      await admin`DELETE FROM users WHERE id = ${expiredUser}`;
    }
  });

  it("9. revoked invitation fails closed — no membership created", async () => {
    const revokedUser = randomUUID();
    await admin`INSERT INTO users (id, full_name, status) VALUES (${revokedUser}, 'Revoked Invitee', 'ACTIVE')`;
    try {
      const { raw, invite } = await seedInvite();
      await withRuntimeContext({ userId: ownerAId, workspaceId: workspaceAId }, (db) => revokeInvitation(db, invite.id));

      const result = await withRuntimeContext({ userId: revokedUser }, (db) =>
        acceptInvitationTx(db, { tokenHash: hash(raw), accepterUserId: revokedUser }),
      );
      expect(result.ok).toBe(false);
      const memberships = await admin`SELECT id FROM memberships WHERE workspace_id = ${workspaceAId} AND user_id = ${revokedUser}`;
      expect(memberships).toHaveLength(0);
    } finally {
      await admin`DELETE FROM users WHERE id = ${revokedUser}`;
    }
  });
});
