/**
 * Phase 10 — genuine concurrency race tests, real Postgres.
 *
 * Every prior phase's "version conflict" tests fire requests SEQUENTIALLY
 * (stale-version-then-retry) — real proof the check exists, but not proof
 * it holds under an actual simultaneous race. These tests fire
 * `Promise.all([...])` — two (or more) transactions issued at literally
 * the same moment — and prove the DB's own lock/constraint is what
 * serializes them correctly, not application-level sequencing (the Phase
 * 10 correction's own explicit requirement: "DB invariants يجب أن تكون
 * آخر خط دفاع، وليس application check فقط").
 *
 * Requires migrations 0001-0046 applied.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  withRuntimeContext,
  recordPaymentTransaction,
  updateSubscriptionStateTransaction,
  OBLIGATION_NOT_FOUND,
  PAYMENT_EXCEEDS_REMAINING,
  SUBSCRIPTION_VERSION_CONFLICT,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);
const hasLiveCreds = !!DATABASE_URL && !!MIGRATION_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[concurrency-races.integration.test] Skipping: requires DATABASE_URL AND MIGRATION_DATABASE_URL " +
      "(distinct connection strings), AND this package already built (`pnpm build`). Expected to skip " +
      "in CI / sandboxes without live Supabase credentials — this is not a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 10 Concurrency Races (live Postgres)", () => {
  let admin: Sql;
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const groupId = randomUUID();
  const monthId = randomUUID();
  const groupMonthId = randomUUID();
  const studentId = randomUUID();
  const enrollmentId = randomUUID();
  const obligationId = randomUUID();
  const subscriptionId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES (${userId}, 'Concurrency Test User', 'concurrency-test@example.test', 'ACTIVE')`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceId}, ${userId}, 'Concurrency Test Workspace', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES (${groupId}, ${workspaceId}, 'Concurrency Test Group', 'ACTIVE')`;
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${monthId}, ${workspaceId}, 2026, 8, 'CURRENT', ${userId})`;
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES (${groupMonthId}, ${workspaceId}, ${groupId}, ${monthId}, 30000, 'PER_GROUP', 'FULL')`;
    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES (${studentId}, ${workspaceId}, 'AP-CONC1', 'Concurrency Student', 'concurrency student', 'ACTIVE')`;
    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES (${enrollmentId}, ${workspaceId}, ${studentId}, ${groupMonthId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;
    // remaining_minor = 30000 — exactly enough for ONE of two concurrent 20000-minor payments, never both.
    await admin`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, base_fee_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, status, calculation_basis) VALUES
      (${obligationId}, ${workspaceId}, ${enrollmentId}, 30000, 30000, '2026-08-05', 0, 30000, 'UNPAID', 'FULL_MONTH')`;

    await admin`INSERT INTO subscriptions (id, workspace_id, state, period_start, period_end, version) VALUES
      (${subscriptionId}, ${workspaceId}, 'ACTIVE', now(), now() + interval '30 days', 1)`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM outbox_events WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM audit_events WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM entitlements WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM subscriptions WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM payments WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM financial_obligations WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM enrollments WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM students WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM group_months WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM operating_months WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM groups WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await admin`DELETE FROM users WHERE id = ${userId}`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("payment overrun race: two SIMULTANEOUS payments that together exceed remainingMinor — the DB row lock (SELECT ... FOR UPDATE) serializes them, never both succeed", async () => {
    const basePaymentInput = {
      workspaceId,
      obligationId,
      amountMinor: 20000, // two of these (40000) exceed the 30000 remaining
      method: "CASH" as const,
      paidAt: new Date(),
      recordedByUserId: userId,
      actorMembershipId: null,
    };

    const [resultA, resultB] = await Promise.all([
      withRuntimeContext({ workspaceId }, (tx) => recordPaymentTransaction(tx, { ...basePaymentInput, idempotencyKey: "race-a" })),
      withRuntimeContext({ workspaceId }, (tx) => recordPaymentTransaction(tx, { ...basePaymentInput, idempotencyKey: "race-b" })),
    ]);

    const outcomes = [resultA, resultB];
    const succeeded = outcomes.filter((r) => r !== OBLIGATION_NOT_FOUND && r !== PAYMENT_EXCEEDS_REMAINING && r !== "OBLIGATION_NOT_PAYABLE");
    const rejected = outcomes.filter((r) => r === PAYMENT_EXCEEDS_REMAINING);

    // Exactly one wins, the other is correctly rejected by the SAME
    // transactional check — reading remainingMinor AFTER the row lock is
    // acquired, not before, is what makes this safe under real concurrency.
    expect(succeeded).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // `bigint` columns come back as strings over the raw postgres.js driver (no ORM-level coercion here) — compare numerically, not by exact type.
    const rows = await admin`SELECT remaining_minor, amount_paid_minor, status FROM financial_obligations WHERE id = ${obligationId}`;
    expect(Number(rows[0]!.remaining_minor)).toBe(10000); // 30000 - 20000, never negative, never double-deducted
    expect(Number(rows[0]!.amount_paid_minor)).toBe(20000);
    expect(rows[0]!.status).toBe("PARTIAL");

    const paymentRows = await admin`SELECT count(*)::int AS c FROM payments WHERE obligation_id = ${obligationId}`;
    expect(paymentRows[0]!.c).toBe(1); // only the winning payment was ever inserted
  });

  it("subscription webhook race: two SIMULTANEOUS state transitions against the SAME expectedVersion — optimistic version check (a DB-level UPDATE...WHERE version=X) serializes them, never both succeed", async () => {
    const current = (await admin`SELECT version FROM subscriptions WHERE id = ${subscriptionId}`)[0]!;

    const [resultA, resultB] = await Promise.all([
      withRuntimeContext({ workspaceId }, (tx) =>
        updateSubscriptionStateTransaction(tx, {
          id: subscriptionId,
          workspaceId,
          expectedVersion: current.version as number,
          nextState: "PAYMENT_FAILED",
          sourceType: "SUBSCRIPTION",
          sourceId: null,
          actorUserId: null,
          actorMembershipId: null,
          correlationId: "race-payment-failed",
        }),
      ),
      withRuntimeContext({ workspaceId }, (tx) =>
        updateSubscriptionStateTransaction(tx, {
          id: subscriptionId,
          workspaceId,
          expectedVersion: current.version as number,
          nextState: "CANCELLED_AT_PERIOD_END",
          cancelAtPeriodEnd: true,
          sourceType: "SUBSCRIPTION",
          sourceId: null,
          actorUserId: null,
          actorMembershipId: null,
          correlationId: "race-cancel",
        }),
      ),
    ]);

    const outcomes = [resultA, resultB];
    const conflicts = outcomes.filter((r) => r === SUBSCRIPTION_VERSION_CONFLICT);
    const winners = outcomes.filter((r) => r !== SUBSCRIPTION_VERSION_CONFLICT);
    expect(conflicts).toHaveLength(1);
    expect(winners).toHaveLength(1);

    // Exactly ONE entitlement recompute happened for this transition, not two conflicting ones.
    const finalSub = await admin`SELECT state, version FROM subscriptions WHERE id = ${subscriptionId}`;
    expect(finalSub[0]!.version).toBe((current.version as number) + 1); // incremented exactly once, not twice
    expect(["PAYMENT_FAILED", "CANCELLED_AT_PERIOD_END"]).toContain(finalSub[0]!.state);
  });
});
