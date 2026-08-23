/**
 * Phase 3 — Months/Groups/Scheduling real-Postgres integration tests.
 *
 * Mirrors `./rls-security.integration.test.ts` exactly: two distinct real
 * connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL` app_runtime),
 * imports the COMPILED package entry point (`../dist/index.js`) rather than
 * raw TS source for the same dual-package-hazard reason documented there,
 * and self-skips entirely when live credentials + a prior build aren't
 * available — this is expected in this sandbox and in CI; it is NOT part of
 * what `pnpm test` needs to pass without live Supabase credentials.
 *
 * Requires migrations 0008-0012 to already be applied against the target
 * database.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withRuntimeContext } from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);

const hasLiveCreds =
  !!DATABASE_URL &&
  !!MIGRATION_DATABASE_URL &&
  DATABASE_URL !== MIGRATION_DATABASE_URL &&
  distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[scheduling-security.integration.test] Skipping: requires DATABASE_URL (app_runtime) and " +
      "MIGRATION_DATABASE_URL (postgres) set to distinct connection strings, AND this package " +
      "already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not " +
      "a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 3 Scheduling Security (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const membershipAId = randomUUID();
  const membershipBId = randomUUID();
  const groupAId = randomUUID();
  const groupBId = randomUUID();
  const monthAId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Scheduling Test User A', 'sched-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'Scheduling Test User B', 'sched-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Scheduling Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Scheduling Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${membershipAId}, ${workspaceAId}, ${userAId}, 'OWNER', 'ACTIVE', now()),
      (${membershipBId}, ${workspaceBId}, ${userBId}, 'OWNER', 'ACTIVE', now())`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupAId}, ${workspaceAId}, 'Scheduling Test Group A', 'ACTIVE'),
      (${groupBId}, ${workspaceBId}, 'Scheduling Test Group B', 'ACTIVE')`;

    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES
      (${monthAId}, ${workspaceAId}, 2026, 8, 'CURRENT', ${userAId})`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM sessions WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM schedule_rules WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM group_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM permission_group_scopes WHERE group_id IN (${groupAId}, ${groupBId})`;
      await admin`DELETE FROM operating_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM groups WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM memberships WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("1. cross-workspace group creation scoped to A but referencing B is rejected by RLS", async () => {
    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO groups (id, workspace_id, name, status) VALUES (${randomUUID()}, ${workspaceBId}, 'cross-tenant', 'ACTIVE')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("2. cross-workspace group_months creation referencing a foreign operating_month is rejected by RLS", async () => {
    await expect(
      withRuntimeContext({ userId: userBId, workspaceId: workspaceBId }, (db) =>
        db.execute(
          sql`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
              VALUES (${randomUUID()}, ${workspaceBId}, ${groupBId}, ${monthAId}, 10000, 'PER_GROUP', 'FULL')`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("3. RLS blocks cross-workspace SELECT on groups for app_runtime", async () => {
    const rows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM groups WHERE id = ${groupBId}`),
    );
    expect(rows).toHaveLength(0);

    const allGroups = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT id FROM groups`),
    );
    const ids = allGroups.map((r) => (r as { id: string }).id);
    expect(ids).toContain(groupAId);
    expect(ids).not.toContain(groupBId);
  });

  it("4. the deferred permission_group_scopes.group_id FK rejects a nonexistent group id", async () => {
    // Uses the privileged admin connection directly — proves the DB-level
    // referential integrity itself, independent of GroupOwnershipPort's
    // application-layer same-workspace check.
    const grantId = randomUUID();
    await admin`INSERT INTO permission_grants (id, workspace_id, membership_id, permission_key, scope_type, created_by_user_id)
      VALUES (${grantId}, ${workspaceAId}, ${membershipAId}, 'groups.view', 'SELECTED_GROUPS', ${userAId})`;

    await expect(
      admin`INSERT INTO permission_group_scopes (id, permission_grant_id, group_id)
        VALUES (${randomUUID()}, ${grantId}, ${randomUUID()})`,
    ).rejects.toThrow(/foreign key/i);

    // A real group id (even from a different workspace) DOES satisfy the FK
    // itself — the FK only proves referential existence, not same-workspace
    // membership; that remains GroupOwnershipPort's job.
    const scopeId = randomUUID();
    await admin`INSERT INTO permission_group_scopes (id, permission_grant_id, group_id)
      VALUES (${scopeId}, ${grantId}, ${groupBId})`;

    await admin`DELETE FROM permission_group_scopes WHERE id = ${scopeId}`;
    await admin`DELETE FROM permission_grants WHERE id = ${grantId}`;
  });

  it("5. RLS blocks cross-workspace SELECT on sessions for app_runtime", async () => {
    const groupMonthId = randomUUID();
    const sessionId = randomUUID();
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES (${groupMonthId}, ${workspaceAId}, ${groupAId}, ${monthAId}, 10000, 'PER_GROUP', 'FULL')`;
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by)
      VALUES (${sessionId}, ${workspaceAId}, ${groupMonthId}, now(), 60, 'SCHEDULED', 'MANUAL', ${userAId})`;

    const rows = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM sessions WHERE id = ${sessionId}`),
    );
    expect(rows).toHaveLength(0);

    const ownRows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM sessions WHERE id = ${sessionId}`),
    );
    expect(ownRows).toHaveLength(1);
  });
});
