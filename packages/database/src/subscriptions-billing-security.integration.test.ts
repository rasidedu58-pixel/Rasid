/**
 * Phase 8 — Subscription & Entitlements real-Postgres integration tests.
 *
 * Mirrors `./attention-followup-security.integration.test.ts` exactly: two
 * distinct real connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL`
 * app_runtime) PLUS a THIRD, `WORKER_DATABASE_URL` connection authenticating
 * as the dedicated `app_worker` role — exercises the real trial provisioning
 * transaction, the real scheduled expiry scan (exactly the way `apps/worker`'s
 * own polling loop would run it), and RLS/grant boundaries against a real
 * database, proving several of the 12 mandatory Phase 8 test scenarios that
 * a pure in-memory unit test cannot: Trial works for its full 14 days,
 * Cancel-at-period-end does not stop service before `period_end`, Expired
 * blocks operational entitlements while billing/history stay reachable,
 * cross-workspace RLS isolation for `subscriptions`/`entitlements`, and the
 * one-ordinary-trial-per-owner-email anti-abuse rule surviving even a brand
 * new Workspace + a brand new `users.id`.
 *
 * Requires migrations 0001-0038 to already be applied against the target
 * database, and `WORKER_DATABASE_URL` (app_worker role, LOGIN enabled) in
 * addition to the usual DATABASE_URL/MIGRATION_DATABASE_URL.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  getWorkerDb,
  withRuntimeContext,
  runSubscriptionExpiryCheck,
  provisionSubscriptionForNewWorkspaceTransaction,
  updateSubscriptionStateTransaction,
  listCurrentEntitlementsForWorkspace,
  findSubscriptionByWorkspaceId,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);

const hasLiveCreds =
  !!DATABASE_URL &&
  !!MIGRATION_DATABASE_URL &&
  !!WORKER_DATABASE_URL &&
  DATABASE_URL !== MIGRATION_DATABASE_URL &&
  distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[subscriptions-billing-security.integration.test] Skipping: requires DATABASE_URL, " +
      "MIGRATION_DATABASE_URL, AND WORKER_DATABASE_URL (app_worker role, LOGIN enabled), AND this " +
      "package already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not a " +
      "failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 8 Subscriptions/Entitlements Security (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Billing Test User A', 'billing-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'Billing Test User B', 'billing-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Billing Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Billing Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM outbox_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM audit_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM entitlements WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM subscriptions WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM owner_trial_grants WHERE first_user_id IN (${userAId}, ${userBId})`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("1: a new workspace gets a real 14-day TRIAL with all 4 V1 capabilities ALLOWED", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      provisionSubscriptionForNewWorkspaceTransaction(tx, {
        workspaceId: workspaceAId,
        ownerUserId: userAId,
        email: "billing-test-a@example.test",
      }),
    );
    expect(result.isTrial).toBe(true);
    expect(result.subscription.state).toBe("TRIAL");
    const periodDays =
      (result.subscription.periodEnd!.getTime() - result.subscription.periodStart!.getTime()) / (1000 * 60 * 60 * 24);
    expect(periodDays).toBeCloseTo(14, 1);

    const entitlements = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      listCurrentEntitlementsForWorkspace(tx, workspaceAId),
    );
    expect(entitlements).toHaveLength(4);
    expect(entitlements.every((e) => e.state === "ALLOWED")).toBe(true);
  });

  it("4: one ordinary 14-day trial per WORKSPACE OWNER (owner_trial_grants), not merely per workspace — a second workspace under the SAME email never gets a second trial", async () => {
    const secondWorkspaceId = randomUUID();
    const secondOwnerUserId = randomUUID(); // a genuinely different users.id row — proves the block is keyed on the verified email identity, not the user row
    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${secondOwnerUserId}, 'Billing Test User A (second account)', 'billing-test-a@example.test', 'ACTIVE')`;
    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${secondWorkspaceId}, ${secondOwnerUserId}, 'Billing Test Workspace A2', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    try {
      const result = await withRuntimeContext({ workspaceId: secondWorkspaceId }, (tx) =>
        provisionSubscriptionForNewWorkspaceTransaction(tx, {
          workspaceId: secondWorkspaceId,
          ownerUserId: secondOwnerUserId,
          email: "billing-test-a@example.test", // SAME normalized email as test 1's workspace A
        }),
      );
      expect(result.isTrial).toBe(false);
      expect(result.subscription.state).toBe("EXPIRED"); // reuses Expired mechanics, no invented bypass state
      expect(result.subscription.periodStart!.getTime()).toBe(result.subscription.periodEnd!.getTime());

      const entitlements = await withRuntimeContext({ workspaceId: secondWorkspaceId }, (tx) =>
        listCurrentEntitlementsForWorkspace(tx, secondWorkspaceId),
      );
      expect(entitlements.every((e) => e.state === "BLOCKED")).toBe(true);
    } finally {
      await admin`DELETE FROM outbox_events WHERE workspace_id = ${secondWorkspaceId}`;
      await admin`DELETE FROM audit_events WHERE workspace_id = ${secondWorkspaceId}`;
      await admin`DELETE FROM entitlements WHERE workspace_id = ${secondWorkspaceId}`;
      await admin`DELETE FROM subscriptions WHERE workspace_id = ${secondWorkspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${secondWorkspaceId}`;
      await admin`DELETE FROM users WHERE id = ${secondOwnerUserId}`;
    }
  });

  it("2: Trial expiry — a TRIAL whose period_end has passed is picked up by the scheduled expiry scan and blocks operational entitlements", async () => {
    const past = new Date(Date.now() - 60_000);
    await admin`UPDATE subscriptions SET period_end = ${past.toISOString()} WHERE workspace_id = ${workspaceAId}`;

    const workerDb = getWorkerDb();
    const result = await runSubscriptionExpiryCheck(workerDb);
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.expired).toBeGreaterThanOrEqual(1);

    const subscription = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) => findSubscriptionByWorkspaceId(tx, workspaceAId));
    expect(subscription!.state).toBe("EXPIRED");

    const entitlements = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      listCurrentEntitlementsForWorkspace(tx, workspaceAId),
    );
    expect(entitlements.every((e) => e.state === "BLOCKED")).toBe(true);

    // 7: historical reads keep working after Expired — the read itself never throws/blocks.
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId }, (tx) => listCurrentEntitlementsForWorkspace(tx, workspaceAId)),
    ).resolves.toBeDefined();
  });

  it("re-running the scheduled expiry scan after a subscription is already EXPIRED is a naturally idempotent no-op (no duplicate transitions)", async () => {
    const before = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) => findSubscriptionByWorkspaceId(tx, workspaceAId));
    const workerDb = getWorkerDb();
    const result = await runSubscriptionExpiryCheck(workerDb);
    // The now-EXPIRED row from the previous test no longer matches
    // findExpirableSubscriptions' own WHERE state IN (TRIAL, CANCELLED_AT_PERIOD_END) filter.
    const after = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) => findSubscriptionByWorkspaceId(tx, workspaceAId));
    expect(after!.version).toBe(before!.version);
    expect(result.scanned).toBeGreaterThanOrEqual(0);
  });

  it("3: Cancel-at-period-end stays fully ALLOWED until period_end — the expiry scan does NOT touch a CANCELLED_AT_PERIOD_END row whose period_end is still in the future", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const current = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) => findSubscriptionByWorkspaceId(tx, workspaceAId));

    const updated = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      updateSubscriptionStateTransaction(tx, {
        id: current!.id,
        workspaceId: workspaceAId,
        expectedVersion: current!.version,
        nextState: "CANCELLED_AT_PERIOD_END",
        periodEnd: future,
        cancelAtPeriodEnd: true,
        sourceType: "SUBSCRIPTION",
        sourceId: null,
        actorUserId: userAId,
        actorMembershipId: null,
      }),
    );
    expect(updated).not.toBe("SUBSCRIPTION_VERSION_CONFLICT");

    const entitlements = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      listCurrentEntitlementsForWorkspace(tx, workspaceAId),
    );
    expect(entitlements.every((e) => e.state === "ALLOWED")).toBe(true); // full operations, matches Active

    const workerDb = getWorkerDb();
    const result = await runSubscriptionExpiryCheck(workerDb);
    const afterScan = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) => findSubscriptionByWorkspaceId(tx, workspaceAId));
    expect(afterScan!.state).toBe("CANCELLED_AT_PERIOD_END"); // untouched — period_end is still in the future
    expect(result.scanned).toBeGreaterThanOrEqual(0);
  });

  it("entitlements are genuinely append-only: multiple state transitions leave every historical row intact, only the latest effective_from wins at read time", async () => {
    const rows = await admin`SELECT id FROM entitlements WHERE workspace_id = ${workspaceAId} ORDER BY effective_from ASC`;
    // 3 transitions so far (TRIAL provisioning, EXPIRED-by-scan, CANCELLED_AT_PERIOD_END) × 4 capabilities each = 12 rows minimum, none deleted/updated.
    expect(rows.length).toBeGreaterThanOrEqual(12);
    const updateAttempt = await admin`SELECT count(*)::int AS c FROM entitlements WHERE workspace_id = ${workspaceAId} AND effective_to IS NOT NULL`;
    expect(updateAttempt[0]!.c).toBe(0); // effective_to is documented as always-null in this implementation
  });

  it("12: RLS cross-workspace isolation — workspace B never sees workspace A's Subscription/Entitlements, and vice versa", async () => {
    const subForB = await withRuntimeContext({ workspaceId: workspaceBId }, (tx) => findSubscriptionByWorkspaceId(tx, workspaceAId));
    expect(subForB).toBeUndefined();

    const entitlementsForB = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM entitlements WHERE workspace_id = ${workspaceAId}`),
    );
    expect(entitlementsForB).toHaveLength(0);

    const rawCrossSelect = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM subscriptions WHERE workspace_id = ${workspaceAId}`),
    );
    expect(rawCrossSelect).toHaveLength(0);
  });

  it("app_worker's broad SELECT policy (0038) can see workspace A's subscription row with NO ambient workspace context set at all — proven directly, not just via runSubscriptionExpiryCheck's own wrapper", async () => {
    const workerDb = getWorkerDb();
    const rows = await workerDb.execute(sql`SELECT id FROM subscriptions WHERE workspace_id = ${workspaceAId}`);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("app_runtime cannot see another workspace's subscription even with a raw cross-tenant WHERE — RLS, not just query-shape discipline, is what blocks it", async () => {
    await expect(
      withRuntimeContext({ workspaceId: workspaceBId }, (db) => db.execute(sql`SELECT * FROM subscriptions`)),
    ).resolves.not.toContainEqual(expect.objectContaining({ workspace_id: workspaceAId }));
  });
});
