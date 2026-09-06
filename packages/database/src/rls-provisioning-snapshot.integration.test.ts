/**
 * Real-role RLS proof for the two production paths that broke during the launch
 * week (live Postgres, distinct role connections — NOT the admin role as a
 * stand-in for app behavior):
 *   1. app_runtime PROVISIONING (`GET /me` first hit): the real
 *      createUserWorkspaceMembership must succeed under RLS with the correct
 *      app.workspace_id, and must NOT read across tenants.
 *   2. app_platform_admin OPERATIONAL SNAPSHOT: getWorkspaceOperationalSnapshot
 *      must run with no permission denied and stay scoped to the target
 *      workspace (`permission denied for table operating_months` regression).
 *
 * Mirrors finance-security.integration.test.ts: seeds via the admin
 * MIGRATION_DATABASE_URL connection, exercises app_runtime via
 * withRuntimeContext (the app_runtime DATABASE_URL), and the snapshot via
 * getWorkspaceOperationalSnapshot (the app_platform_admin PLATFORM_ADMIN_DATABASE_URL).
 * The equivalent assertions are also proven locally, offline, against a PGlite
 * replica of prod DDL+grants+RLS via SET ROLE (scratchpad/pgtest/rls-proof.mjs).
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createUserWorkspaceMembership, getWorkspaceOperationalSnapshot, withRuntimeContext } from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const PLATFORM_ADMIN_DATABASE_URL = process.env.PLATFORM_ADMIN_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const hasRuntimeCreds = !!DATABASE_URL && !!MIGRATION_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && existsSync(distEntryPoint);
const hasSnapshotCreds = hasRuntimeCreds && !!PLATFORM_ADMIN_DATABASE_URL && PLATFORM_ADMIN_DATABASE_URL !== DATABASE_URL;

if (!hasRuntimeCreds) {
  // eslint-disable-next-line no-console
  console.warn("[rls-provisioning-snapshot.integration.test] Skipping: requires distinct DATABASE_URL (app_runtime) + MIGRATION_DATABASE_URL + built dist. Proven offline via scratchpad/pgtest/rls-proof.mjs.");
}

describe.skipIf(!hasRuntimeCreds)("RLS — provisioning & operational snapshot (live Postgres, real roles)", () => {
  let admin: Sql;
  const wsA = randomUUID();
  const wsB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });
    for (const [ws, owner] of [[wsA, ownerA], [wsB, ownerB]] as const) {
      await admin`INSERT INTO users (id, full_name, email_display, status) VALUES (${owner}, 'RLS Owner', ${"rls-" + owner + "@t.test"}, 'ACTIVE')`;
      await admin`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES (${ws}, ${owner}, 'RLS WS', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
      await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${randomUUID()}, ${ws}, 2026, 8, 'CURRENT', ${owner})`;
    }
  });

  afterAll(async () => {
    if (admin) {
      for (const ws of [wsA, wsB]) {
        await admin`DELETE FROM memberships WHERE workspace_id = ${ws}`;
        await admin`DELETE FROM entitlements WHERE workspace_id = ${ws}`;
        await admin`DELETE FROM subscriptions WHERE workspace_id = ${ws}`;
        await admin`DELETE FROM owner_trial_grants WHERE workspace_id = ${ws}`;
        await admin`DELETE FROM audit_events WHERE workspace_id = ${ws}`;
        await admin`DELETE FROM operating_months WHERE workspace_id = ${ws}`;
        await admin`DELETE FROM workspaces WHERE id = ${ws}`;
      }
      await admin`DELETE FROM users WHERE id IN (${ownerA}, ${ownerB})`;
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("app_runtime provisioning (createUserWorkspaceMembership) SUCCEEDS under RLS with the correct app.workspace_id — the /me path, no permission denied", async () => {
    const authUserId = randomUUID();
    const newWorkspaceId = randomUUID();
    const result = await withRuntimeContext({ userId: authUserId, workspaceId: newWorkspaceId }, (db) =>
      createUserWorkspaceMembership(db, { authUserId, email: `prov-${authUserId}@rasid.invalid`, fullName: "RLS Provision" }, newWorkspaceId),
    );
    expect(result.user.id).toBe(authUserId);
    expect(result.workspace.id).toBe(newWorkspaceId);
    // cleanup this provisioned tenant
    await admin`DELETE FROM memberships WHERE workspace_id = ${newWorkspaceId}`;
    await admin`DELETE FROM entitlements WHERE workspace_id = ${newWorkspaceId}`;
    await admin`DELETE FROM subscriptions WHERE workspace_id = ${newWorkspaceId}`;
    await admin`DELETE FROM owner_trial_grants WHERE workspace_id = ${newWorkspaceId}`;
    await admin`DELETE FROM audit_events WHERE workspace_id = ${newWorkspaceId}`;
    await admin`DELETE FROM workspaces WHERE id = ${newWorkspaceId}`;
    await admin`DELETE FROM users WHERE id = ${authUserId}`;
  });

  it("app_runtime CANNOT read a foreign workspace's rows — RLS tenant isolation (0 rows), and reads its own", async () => {
    const foreign = await withRuntimeContext({ workspaceId: wsA }, (db) =>
      db.execute(sql`SELECT id FROM workspaces WHERE id = ${wsB}`),
    );
    expect(foreign).toHaveLength(0);
    const own = await withRuntimeContext({ workspaceId: wsA }, (db) =>
      db.execute(sql`SELECT id FROM workspaces WHERE id = ${wsA}`),
    );
    expect(own).toHaveLength(1);
  });

  it.skipIf(!hasSnapshotCreds)("app_platform_admin operational snapshot runs with NO permission denied and stays workspace-scoped", async () => {
    const snap = await getWorkspaceOperationalSnapshot(wsA);
    expect(snap.available).toBe(true); // a permission-denied would degrade this to false
    expect(snap.currentMonth).not.toBeNull();
    expect(typeof snap.groupsCount).toBe("number");
    // scoping: workspace B (seeded with only an operating month, no groups) reports 0 groups
    const snapB = await getWorkspaceOperationalSnapshot(wsB);
    expect(snapB.available).toBe(true);
    expect(snapB.groupsCount).toBe(0);
  });
});
