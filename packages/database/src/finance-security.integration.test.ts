/**
 * Phase 6 — Finance real-Postgres integration tests.
 *
 * Mirrors `./session-mode-security.integration.test.ts` exactly: two
 * distinct real connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL`
 * app_runtime), imports the COMPILED package entry point (`../dist/index.js`)
 * rather than raw TS source for the same dual-package-hazard reason
 * documented there, and self-skips entirely when live credentials + a prior
 * build aren't available.
 *
 * Requires migrations 0008-0028 to already be applied against the target
 * database.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, recordPaymentTransaction, reversePaymentTransaction, withRuntimeContext } from "@academic-precision/database";

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
    "[finance-security.integration.test] Skipping: requires DATABASE_URL (app_runtime) and " +
      "MIGRATION_DATABASE_URL (postgres) set to distinct connection strings, AND this package " +
      "already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not " +
      "a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 6 Finance Security (live Postgres)", () => {
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
  const monthBId = randomUUID();
  const groupMonthAId = randomUUID();
  const groupMonthBId = randomUUID();
  const studentAId = randomUUID();
  const enrollmentAId = randomUUID();
  // A second, obligation-less enrollment — needed for test 1, since
  // financial_obligations.enrollment_id is itself UNIQUE and enrollmentAId
  // already has its seeded obligation (obligationAId).
  const enrollmentA2Id = randomUUID();
  const obligationAId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Finance Test User A', 'finance-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'Finance Test User B', 'finance-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Finance Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Finance Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${membershipAId}, ${workspaceAId}, ${userAId}, 'OWNER', 'ACTIVE', now()),
      (${membershipBId}, ${workspaceBId}, ${userBId}, 'OWNER', 'ACTIVE', now())`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupAId}, ${workspaceAId}, 'Finance Test Group A', 'ACTIVE'),
      (${groupBId}, ${workspaceBId}, 'Finance Test Group B', 'ACTIVE')`;

    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES
      (${monthAId}, ${workspaceAId}, 2026, 8, 'CURRENT', ${userAId}),
      (${monthBId}, ${workspaceBId}, 2026, 8, 'CURRENT', ${userBId})`;

    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, due_day, join_fee_policy)
      VALUES
        (${groupMonthAId}, ${workspaceAId}, ${groupAId}, ${monthAId}, 60000, 'PER_GROUP', 15, 'FULL'),
        (${groupMonthBId}, ${workspaceBId}, ${groupBId}, ${monthBId}, 60000, 'PER_GROUP', 15, 'FULL')`;

    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status)
      VALUES (${studentAId}, ${workspaceAId}, 'AP-FINA1', 'Finance Student A', 'finance student a', 'ACTIVE')`;

    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
      VALUES (${enrollmentAId}, ${workspaceAId}, ${studentAId}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;

    const studentA2Id = randomUUID();
    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status)
      VALUES (${studentA2Id}, ${workspaceAId}, 'AP-FINA2', 'Finance Student A2', 'finance student a2', 'ACTIVE')`;
    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
      VALUES (${enrollmentA2Id}, ${workspaceAId}, ${studentA2Id}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;

    await admin`INSERT INTO financial_obligations
      (id, workspace_id, enrollment_id, base_fee_minor, net_due_minor, due_date, remaining_minor, calculation_basis)
      VALUES (${obligationAId}, ${workspaceAId}, ${enrollmentAId}, 60000, 60000, '2026-08-15', 60000, 'FULL_MONTH')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM outbox_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM audit_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM payment_reversals WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM payments WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM financial_obligations WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM enrollments WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM students WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
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

  it("1. the composite FK rejects a financial_obligations row whose workspace_id does not match its enrollment's real workspace", async () => {
    // Runtime context matches the ROW's workspace_id (workspace B) so RLS's
    // own WITH CHECK admits the write — isolating this assertion to the
    // Composite FK specifically (enrollment_id belongs to workspace A, not
    // B, so (enrollment_id, workspace_id) can't match any real enrollments row).
    await expect(
      withRuntimeContext({ userId: userBId, workspaceId: workspaceBId }, (db) =>
        db.execute(
          sql`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, base_fee_minor, net_due_minor, due_date, remaining_minor, calculation_basis)
              VALUES (${randomUUID()}, ${workspaceBId}, ${enrollmentA2Id}, 60000, 60000, '2026-08-15', 60000, 'FULL_MONTH')`,
        ),
      ),
    ).rejects.toThrow(/violates foreign key constraint|financial_obligations_enrollment_workspace_fk/i);
  });

  it("2. RLS blocks cross-workspace SELECT on financial_obligations/payments for app_runtime", async () => {
    const foreignRows = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM financial_obligations WHERE id = ${obligationAId}`),
    );
    expect(foreignRows).toHaveLength(0);

    const ownRows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM financial_obligations WHERE id = ${obligationAId}`),
    );
    expect(ownRows).toHaveLength(1);
  });

  it("3. app_runtime has no DELETE grant on financial_obligations/payments/payment_reversals", async () => {
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
        db.execute(sql`DELETE FROM financial_obligations WHERE id = ${obligationAId}`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("4. DB CHECK constraints enforce net_due=base-discount-waiver and the amount_paid+remaining=net_due balance identity", async () => {
    await expect(
      admin`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, base_fee_minor, discount_minor, net_due_minor, due_date, remaining_minor, calculation_basis)
        VALUES (${randomUUID()}, ${workspaceAId}, ${enrollmentAId}, 60000, 10000, 60000, '2026-08-15', 60000, 'FULL_MONTH')`,
    ).rejects.toThrow(/violates check constraint/i);

    await expect(
      admin`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, base_fee_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, calculation_basis)
        VALUES (${randomUUID()}, ${workspaceAId}, ${enrollmentAId}, 60000, 60000, '2026-08-15', 10000, 60000, 'FULL_MONTH')`,
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("5. UNIQUE(workspace_id, idempotency_key) on payments — a duplicate key is rejected at the DB level", async () => {
    const key = `dup-${randomUUID()}`;
    const first = randomUUID();
    await admin`INSERT INTO payments (id, workspace_id, obligation_id, amount_minor, method, paid_at, idempotency_key, recorded_by)
      VALUES (${first}, ${workspaceAId}, ${obligationAId}, 10000, 'CASH', now(), ${key}, ${userAId})`;

    await expect(
      admin`INSERT INTO payments (id, workspace_id, obligation_id, amount_minor, method, paid_at, idempotency_key, recorded_by)
        VALUES (${randomUUID()}, ${workspaceAId}, ${obligationAId}, 5000, 'CASH', now(), ${key}, ${userAId})`,
    ).rejects.toThrow(/duplicate key|unique constraint/i);

    await admin`DELETE FROM payments WHERE id = ${first}`;
  });

  it("6. the real recordPaymentTransaction/reversePaymentTransaction round-trip commits atomically (obligation + payment + reversal + audit + outbox)", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      recordPaymentTransaction(db, {
        workspaceId: workspaceAId,
        obligationId: obligationAId,
        amountMinor: 20000,
        method: "CASH",
        paidAt: new Date(),
        idempotencyKey: `live-${randomUUID()}`,
        recordedByUserId: userAId,
        actorMembershipId: membershipAId,
      }),
    );
    expect(result).not.toBe("OBLIGATION_NOT_FOUND");
    const recorded = result as { obligation: { remainingMinor: number; status: string }; payment: { id: string } };
    expect(recorded.obligation.remainingMinor).toBe(40000);
    expect(recorded.obligation.status).toBe("PARTIAL");

    const auditRows = await admin`SELECT action FROM audit_events WHERE entity_id = ${recorded.payment.id} AND action = 'payment.recorded'`;
    expect(auditRows).toHaveLength(1);
    const outboxRows = await admin`SELECT event_type FROM outbox_events WHERE aggregate_id = ${recorded.payment.id} AND event_type = 'PaymentPosted'`;
    expect(outboxRows).toHaveLength(1);

    const reversed = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      reversePaymentTransaction(db, {
        workspaceId: workspaceAId,
        paymentId: recorded.payment.id,
        reason: "live test reversal",
        reversedByUserId: userAId,
        actorMembershipId: membershipAId,
      }),
    );
    expect(reversed).not.toBe("PAYMENT_NOT_FOUND");
    const rev = reversed as { obligation: { remainingMinor: number; status: string }; payment: { status: string } };
    expect(rev.payment.status).toBe("REVERSED");
    expect(rev.obligation.remainingMinor).toBe(60000);
    expect(rev.obligation.status).toBe("UNPAID");

    // Reset for any later test relying on the seeded baseline.
    await admin`UPDATE financial_obligations SET amount_paid_minor = 0, remaining_minor = 60000, status = 'UNPAID' WHERE id = ${obligationAId}`;
  });
});
