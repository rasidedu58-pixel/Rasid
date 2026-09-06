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
  createOrReactivateEnrollmentTransaction,
  insertStudentWithUniqueCode,
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

  it("enrollment duplicate race: two SIMULTANEOUS identical enrollments (same student + group_month) — the ON CONFLICT upsert makes exactly ONE row and BOTH callers SUCCEED (the race-loser reactivates, never a generic 'تعذر التسجيل')", async () => {
    const raceStudentId = randomUUID();
    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES (${raceStudentId}, ${workspaceId}, 'AP-ENRLR', 'Enroll Race Student', 'enroll race student', 'ACTIVE')`;

    const input = {
      workspaceId,
      studentId: raceStudentId,
      groupMonthId,
      joinDate: "2026-08-01",
      status: "PENDING" as const, // PENDING takes NO capacity lock — the exact path that used to race
      feeMethod: "FULL_MONTH" as const,
      obligation: { baseFeeMinor: 30000, currencyCode: "EGP", dueDate: "2026-08-10", calculationBasis: "FULL_MONTH" as const, calculationSnapshotJson: {} },
    };

    const [a, b] = await Promise.all([
      withRuntimeContext({ workspaceId }, (tx) => createOrReactivateEnrollmentTransaction(tx, input)),
      withRuntimeContext({ workspaceId }, (tx) => createOrReactivateEnrollmentTransaction(tx, input)),
    ]);

    // Neither call threw; both reference the SAME single enrollment row.
    expect(a.enrollment.id).toBe(b.enrollment.id);
    // Exactly one is a fresh create and the other a reactivation — never two "created".
    expect([a.reactivated, b.reactivated].sort()).toEqual([false, true]);

    const eRows = await admin`SELECT count(*)::int AS c FROM enrollments WHERE student_id = ${raceStudentId} AND group_month_id = ${groupMonthId}`;
    expect(eRows[0]!.c).toBe(1); // no duplicate enrollment row
    const oRows = await admin`SELECT count(*)::int AS c FROM financial_obligations WHERE enrollment_id = ${a.enrollment.id}`;
    expect(oRows[0]!.c).toBe(1); // and exactly one obligation
  });

  it("student create race: two SIMULTANEOUS creates with the SAME name — both SUCCEED as DISTINCT students (a student has no dedup key by design), never a 500 from a code collision", async () => {
    const create = () =>
      withRuntimeContext({ workspaceId }, (tx) =>
        insertStudentWithUniqueCode(tx, { workspaceId, name: "Race Duplicate Name", searchNameNormalized: "race duplicate name" }),
      );
    const [s1, s2] = await Promise.all([create(), create()]);

    expect(s1.id).not.toBe(s2.id); // two real, distinct students (same name = different people)
    expect(s1.studentCode).not.toBe(s2.studentCode); // distinct display codes — no collision, no 500
    const rows = await admin`SELECT count(*)::int AS c FROM students WHERE workspace_id = ${workspaceId} AND name = 'Race Duplicate Name'`;
    expect(rows[0]!.c).toBe(2);
  });

  it("payment idempotency race: two SIMULTANEOUS payments with the SAME idempotency key — exactly ONE payment row, and BOTH callers get that same payment (never a duplicate-key 500 or a false overpay)", async () => {
    const stuId = randomUUID();
    const enrId = randomUUID();
    const oblId = randomUUID();
    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES (${stuId}, ${workspaceId}, 'AP-PAYIR', 'Idem Race Student', 'idem race student', 'ACTIVE')`;
    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES (${enrId}, ${workspaceId}, ${stuId}, ${groupMonthId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;
    await admin`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, base_fee_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, status, calculation_basis) VALUES
      (${oblId}, ${workspaceId}, ${enrId}, 30000, 30000, '2026-08-05', 0, 30000, 'UNPAID', 'FULL_MONTH')`;

    const input = {
      workspaceId,
      obligationId: oblId,
      amountMinor: 20000,
      method: "CASH" as const,
      paidAt: new Date(),
      recordedByUserId: userId,
      actorMembershipId: null,
      idempotencyKey: "idem-same-key-race", // SAME key on both → one logical payment
    };

    const [a, b] = await Promise.all([
      withRuntimeContext({ workspaceId }, (tx) => recordPaymentTransaction(tx, input)),
      withRuntimeContext({ workspaceId }, (tx) => recordPaymentTransaction(tx, input)),
    ]);

    // Both are success objects (neither the overpay nor not-found/not-payable marker).
    expect(typeof a).toBe("object");
    expect(typeof b).toBe("object");
    const pa = a as { payment: { id: string } };
    const pb = b as { payment: { id: string } };
    expect(pa.payment.id).toBe(pb.payment.id); // both callers see the SAME payment

    const rows = await admin`SELECT count(*)::int AS c FROM payments WHERE obligation_id = ${oblId}`;
    expect(rows[0]!.c).toBe(1); // exactly one payment ever inserted — no double charge, no 500
    const obl = await admin`SELECT amount_paid_minor, remaining_minor FROM financial_obligations WHERE id = ${oblId}`;
    expect(Number(obl[0]!.amount_paid_minor)).toBe(20000); // charged once, not 40000
    expect(Number(obl[0]!.remaining_minor)).toBe(10000);
  });
});
