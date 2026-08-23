/**
 * Phase 8 — Subscription & Entitlements real-Postgres integration tests.
 * Extended by the Phase 8 Closure Delta (trial ownership integrity +
 * entitlement temporal integrity).
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
 * cross-workspace RLS isolation for `subscriptions`/`entitlements`, the
 * one-ordinary-trial-per-owner-IDENTITY anti-abuse rule (both `UNIQUE`
 * constraints on `owner_trial_grants`), and the append+close entitlement
 * temporal model (DB-level partial unique index + column-restricted grants)
 * added by the Closure Delta.
 *
 * Requires migrations 0001-0040 to already be applied against the target
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

  describe("4: Closure Delta #1 — one ordinary trial per WORKSPACE OWNER (both UNIQUE(email_hash) AND UNIQUE(first_user_id))", () => {
    /** Provisions a scratch user+workspace, runs provisioning, returns the result, and ALWAYS cleans up its own rows regardless of outcome. */
    async function provisionScratch(params: {
      userId: string;
      userLabel: string;
      workspaceId: string;
      workspaceLabel: string;
      email: string | null;
    }): Promise<Awaited<ReturnType<typeof provisionSubscriptionForNewWorkspaceTransaction>>> {
      await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
        (${params.userId}, ${params.userLabel}, ${params.email ?? "no-email@example.test"}, 'ACTIVE')`;
      await admin`INSERT INTO workspaces
        (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
        (${params.workspaceId}, ${params.userId}, ${params.workspaceLabel}, 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
      return withRuntimeContext({ workspaceId: params.workspaceId }, (tx) =>
        provisionSubscriptionForNewWorkspaceTransaction(tx, {
          workspaceId: params.workspaceId,
          ownerUserId: params.userId,
          email: params.email,
        }),
      );
    }

    async function cleanupScratch(userId: string, workspaceId: string): Promise<void> {
      await admin`DELETE FROM outbox_events WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM audit_events WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM entitlements WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM subscriptions WHERE workspace_id = ${workspaceId}`;
      // owner_trial_grants FKs to BOTH workspaces AND users (restrict) — must
      // clear it before either parent row can be deleted.
      await admin`DELETE FROM owner_trial_grants WHERE first_workspace_id = ${workspaceId} OR first_user_id = ${userId}`;
      await admin`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await admin`DELETE FROM users WHERE id = ${userId}`;
    }

    it("4.1: same user + same email, provisioned twice (two workspaces) → exactly one trial", async () => {
      const ownerUserId = randomUUID();
      const workspace1Id = randomUUID();
      const workspace2Id = randomUUID();
      const email = "closure-delta-4-1@example.test";
      try {
        // First workspace for this owner: real trial.
        const first = await provisionScratch({
          userId: ownerUserId,
          userLabel: "Closure Delta 4.1 Owner",
          workspaceId: workspace1Id,
          workspaceLabel: "Closure Delta 4.1 WS1",
          email,
        });
        expect(first.isTrial).toBe(true);

        // Second workspace, SAME owner, SAME email → blocked (first_user_id AND email_hash both already consumed).
        await admin`INSERT INTO workspaces
          (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
          (${workspace2Id}, ${ownerUserId}, 'Closure Delta 4.1 WS2', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
        const second = await withRuntimeContext({ workspaceId: workspace2Id }, (tx) =>
          provisionSubscriptionForNewWorkspaceTransaction(tx, { workspaceId: workspace2Id, ownerUserId, email }),
        );
        expect(second.isTrial).toBe(false);
        expect(second.subscription.state).toBe("EXPIRED");
      } finally {
        // workspace2 (owner_user_id = ownerUserId) must be gone BEFORE
        // cleanupScratch deletes the user row itself, or the user delete
        // hits workspaces_owner_user_id_users_id_fk.
        await admin`DELETE FROM outbox_events WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM audit_events WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM entitlements WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM subscriptions WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM workspaces WHERE id = ${workspace2Id}`;
        await cleanupScratch(ownerUserId, workspace1Id);
      }
    });

    it("4.2: same user + a DIFFERENT (changed) verified email on a second workspace → still no second trial (UNIQUE(first_user_id) is what blocks it)", async () => {
      const ownerUserId = randomUUID();
      const workspace1Id = randomUUID();
      const workspace2Id = randomUUID();
      try {
        const first = await provisionScratch({
          userId: ownerUserId,
          userLabel: "Closure Delta 4.2 Owner",
          workspaceId: workspace1Id,
          workspaceLabel: "Closure Delta 4.2 WS1",
          email: "closure-delta-4-2-old@example.test",
        });
        expect(first.isTrial).toBe(true);

        await admin`INSERT INTO workspaces
          (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
          (${workspace2Id}, ${ownerUserId}, 'Closure Delta 4.2 WS2', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
        const second = await withRuntimeContext({ workspaceId: workspace2Id }, (tx) =>
          provisionSubscriptionForNewWorkspaceTransaction(tx, {
            workspaceId: workspace2Id,
            ownerUserId, // SAME owner
            email: "closure-delta-4-2-new@example.test", // genuinely DIFFERENT verified email
          }),
        );
        expect(second.isTrial).toBe(false);
        expect(second.subscription.state).toBe("EXPIRED");

        const grants = await admin`SELECT count(*)::int AS c FROM owner_trial_grants WHERE first_user_id = ${ownerUserId}`;
        expect(grants[0]!.c).toBe(1); // still just the ONE original grant row — no second row was ever inserted for this owner
      } finally {
        // workspace2 (owner_user_id = ownerUserId) must be gone BEFORE
        // cleanupScratch deletes the user row itself, or the user delete
        // hits workspaces_owner_user_id_users_id_fk.
        await admin`DELETE FROM outbox_events WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM audit_events WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM entitlements WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM subscriptions WHERE workspace_id = ${workspace2Id}`;
        await admin`DELETE FROM workspaces WHERE id = ${workspace2Id}`;
        await cleanupScratch(ownerUserId, workspace1Id);
      }
    });

    it("4.3: a genuinely NEW user + a PREVIOUSLY-used verified email → no second trial (UNIQUE(email_hash) is what blocks it)", async () => {
      const firstOwnerUserId = randomUUID();
      const firstWorkspaceId = randomUUID();
      const secondOwnerUserId = randomUUID();
      const secondWorkspaceId = randomUUID();
      const sharedEmail = "closure-delta-4-3@example.test";
      try {
        const first = await provisionScratch({
          userId: firstOwnerUserId,
          userLabel: "Closure Delta 4.3 Owner 1",
          workspaceId: firstWorkspaceId,
          workspaceLabel: "Closure Delta 4.3 WS1",
          email: sharedEmail,
        });
        expect(first.isTrial).toBe(true);

        // A genuinely different users.id row (simulates delete-account-and-recreate) reusing the SAME verified email.
        const second = await provisionScratch({
          userId: secondOwnerUserId,
          userLabel: "Closure Delta 4.3 Owner 2 (recreated)",
          workspaceId: secondWorkspaceId,
          workspaceLabel: "Closure Delta 4.3 WS2",
          email: sharedEmail,
        });
        expect(second.isTrial).toBe(false);
        expect(second.subscription.state).toBe("EXPIRED");

        const entitlements = await withRuntimeContext({ workspaceId: secondWorkspaceId }, (tx) =>
          listCurrentEntitlementsForWorkspace(tx, secondWorkspaceId),
        );
        expect(entitlements.every((e) => e.state === "BLOCKED")).toBe(true);
      } finally {
        await cleanupScratch(firstOwnerUserId, firstWorkspaceId);
        await cleanupScratch(secondOwnerUserId, secondWorkspaceId);
      }
    });

    it("4.4: a genuinely NEW user + a genuinely NEW verified email → trial allowed", async () => {
      const ownerUserId = randomUUID();
      const workspaceId = randomUUID();
      try {
        const result = await provisionScratch({
          userId: ownerUserId,
          userLabel: "Closure Delta 4.4 Owner",
          workspaceId,
          workspaceLabel: "Closure Delta 4.4 WS",
          email: "closure-delta-4-4@example.test",
        });
        expect(result.isTrial).toBe(true);
        expect(result.subscription.state).toBe("TRIAL");
        const entitlements = await withRuntimeContext({ workspaceId }, (tx) => listCurrentEntitlementsForWorkspace(tx, workspaceId));
        expect(entitlements.every((e) => e.state === "ALLOWED")).toBe(true);
      } finally {
        await cleanupScratch(ownerUserId, workspaceId);
      }
    });
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

  describe("Closure Delta #2 — entitlement temporal integrity (append+close)", () => {
    // By this point workspaceA has gone through 3 real transitions: TRIAL
    // (provisioning) -> EXPIRED (expiry scan) -> CANCELLED_AT_PERIOD_END
    // (manual update in test '3') — 3 x 4 capabilities = 12 rows total, 8
    // closed + 4 open.

    it("exactly one OPEN entitlement row per capability after multiple state transitions, and it's the one returned by listCurrentEntitlementsForWorkspace", async () => {
      const openRows = await admin`SELECT capability FROM entitlements WHERE workspace_id = ${workspaceAId} AND effective_to IS NULL ORDER BY capability`;
      expect(openRows.map((r) => r.capability as string)).toEqual(
        ["CORE_OPERATIONS", "CREATE_MONTH", "REPORT_EXPORT", "TEAM_MANAGEMENT"].sort(),
      );

      const current = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) => listCurrentEntitlementsForWorkspace(tx, workspaceAId));
      expect(current).toHaveLength(4);
      expect(current.every((e) => e.effectiveTo === null)).toBe(true);
      expect(current.every((e) => e.state === "ALLOWED")).toBe(true); // latest transition was CANCELLED_AT_PERIOD_END -> full operations
    });

    it("every PREVIOUS (non-open) row has a non-null effective_to, and nothing was deleted", async () => {
      const allRows = await admin`SELECT effective_to FROM entitlements WHERE workspace_id = ${workspaceAId}`;
      expect(allRows.length).toBeGreaterThanOrEqual(12);
      const closedRows = allRows.filter((r) => r.effective_to !== null);
      expect(closedRows.length).toBeGreaterThanOrEqual(8); // 2 closed transitions x 4 capabilities
    });

    it("time ranges do not overlap: for each capability, a closed row's effective_to equals the NEXT row's effective_from exactly", async () => {
      const rows = await admin`
        SELECT capability, effective_from, effective_to
        FROM entitlements
        WHERE workspace_id = ${workspaceAId}
        ORDER BY capability, effective_from ASC`;
      const byCapability = new Map<string, { effective_from: Date; effective_to: Date | null }[]>();
      for (const row of rows) {
        const list = byCapability.get(row.capability as string) ?? [];
        list.push({ effective_from: row.effective_from as Date, effective_to: row.effective_to as Date | null });
        byCapability.set(row.capability as string, list);
      }
      expect(byCapability.size).toBe(4);
      for (const [, ranges] of byCapability) {
        expect(ranges.length).toBeGreaterThanOrEqual(3);
        for (let i = 0; i < ranges.length - 1; i++) {
          // The row's own close time must equal the NEXT row's own open time — no gap, no overlap.
          expect(ranges[i]!.effective_to?.getTime()).toBe(ranges[i + 1]!.effective_from.getTime());
        }
        // Only the LAST range in the ordered list is open.
        expect(ranges[ranges.length - 1]!.effective_to).toBeNull();
        for (let i = 0; i < ranges.length - 1; i++) {
          expect(ranges[i]!.effective_to).not.toBeNull();
        }
      }
    });

    it("a FAILED subscription transition (version conflict) leaves entitlements completely untouched — no partial close, no partial insert", async () => {
      const before = await admin`SELECT id, effective_from, effective_to FROM entitlements WHERE workspace_id = ${workspaceAId} ORDER BY effective_from ASC`;
      const current = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) => findSubscriptionByWorkspaceId(tx, workspaceAId));

      const result = await withRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
        updateSubscriptionStateTransaction(tx, {
          id: current!.id,
          workspaceId: workspaceAId,
          expectedVersion: current!.version + 999, // deliberately stale/wrong
          nextState: "ACTIVE",
          sourceType: "SUBSCRIPTION",
          sourceId: null,
          actorUserId: userAId,
          actorMembershipId: null,
        }),
      );
      expect(result).toBe("SUBSCRIPTION_VERSION_CONFLICT");

      const after = await admin`SELECT id, effective_from, effective_to FROM entitlements WHERE workspace_id = ${workspaceAId} ORDER BY effective_from ASC`;
      expect(after).toEqual(before); // byte-for-byte identical — the failed subscription UPDATE never reached the entitlement close/insert pair
    });

    it("app_runtime cannot arbitrarily rewrite historical entitlement state — column-level GRANT permits closing effective_to only, never state/capability", async () => {
      const closedRow = await admin`SELECT id FROM entitlements WHERE workspace_id = ${workspaceAId} AND effective_to IS NOT NULL LIMIT 1`;
      expect(closedRow.length).toBe(1);
      const closedRowId = closedRow[0]!.id as string;

      await expect(
        withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
          db.execute(sql`UPDATE entitlements SET state = 'BLOCKED' WHERE id = ${closedRowId}`),
        ),
      ).rejects.toThrow(/permission denied/i);

      await expect(
        withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
          db.execute(sql`UPDATE entitlements SET capability = 'CORE_OPERATIONS' WHERE id = ${closedRowId}`),
        ),
      ).rejects.toThrow(/permission denied/i);

      // The one column it DOES have — effective_to — still succeeds (this is the exact grant the append+close transaction itself relies on).
      const readBack = await admin`SELECT effective_to FROM entitlements WHERE id = ${closedRowId}`;
      const effectiveToIso = (readBack[0]!.effective_to as Date).toISOString();
      await expect(
        withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
          db.execute(sql`UPDATE entitlements SET effective_to = ${effectiveToIso} WHERE id = ${closedRowId}`),
        ),
      ).resolves.toBeDefined();
    });

    it("app_worker is likewise restricted to the same column-level UPDATE on entitlements (never arbitrary rewrite)", async () => {
      const closedRow = await admin`SELECT id FROM entitlements WHERE workspace_id = ${workspaceAId} AND effective_to IS NOT NULL LIMIT 1`;
      const closedRowId = closedRow[0]!.id as string;
      const workerDb = getWorkerDb();
      await expect(workerDb.execute(sql`UPDATE entitlements SET state = 'BLOCKED' WHERE id = ${closedRowId}`)).rejects.toThrow(
        /permission denied/i,
      );
    });

    it("RLS isolation remains intact after the temporal-integrity delta: workspace B still sees zero of workspace A's entitlement rows, open or closed", async () => {
      const rowsForB = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
        db.execute(sql`SELECT * FROM entitlements WHERE workspace_id = ${workspaceAId}`),
      );
      expect(rowsForB).toHaveLength(0);
    });
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
