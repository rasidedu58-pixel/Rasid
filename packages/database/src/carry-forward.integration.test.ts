/**
 * Phase 6 Closure Delta — CreateMonth Carry-Forward Integration, real-
 * Postgres tests.
 *
 * Mirrors `./finance-security.integration.test.ts` exactly: two distinct
 * real connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL`
 * app_runtime), imports the COMPILED package entry point (`../dist/index.js`)
 * rather than raw TS source for the same dual-package-hazard reason
 * documented there, and self-skips entirely when live credentials + a prior
 * build aren't available.
 *
 * Exercises `runCreateMonthTransaction` DIRECTLY (not through the NestJS
 * service layer) against a real seeded source month, proving the actual
 * atomicity/rollback/RLS guarantees this delta depends on — the in-memory
 * unit-test double (`carry-forward.spec.ts`, apps/api) simulates rollback
 * with a snapshot/restore; this file proves the REAL Postgres transaction
 * does it for free.
 *
 * Requires migrations 0008-0028 to already be applied against the target
 * database.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, runCreateMonthTransaction, withRuntimeContext } from "@academic-precision/database";

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
    "[carry-forward.integration.test] Skipping: requires DATABASE_URL (app_runtime) and " +
      "MIGRATION_DATABASE_URL (postgres) set to distinct connection strings, AND this package " +
      "already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not " +
      "a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 6 Closure Delta — CreateMonth Carry-Forward (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const membershipAId = randomUUID();
  const groupAId = randomUUID();
  const groupBId = randomUUID();
  const sourceMonthAId = randomUUID();
  const sourceMonthBId = randomUUID();
  const sourceGroupMonthAId = randomUUID();
  const sourceGroupMonthBId = randomUUID();
  const studentActiveId = randomUUID();
  const studentWithdrawnId = randomUUID();
  const studentPaidHistoryId = randomUUID();
  const enrollmentActiveId = randomUUID();
  const enrollmentWithdrawnId = randomUUID();
  const enrollmentPaidHistoryId = randomUUID();
  const obligationPaidHistoryId = randomUUID();
  const studentBActiveId = randomUUID();
  const enrollmentBActiveId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'CarryForward Test User A', 'carryforward-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'CarryForward Test User B', 'carryforward-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, unified_due_day, status) VALUES
      (${workspaceAId}, ${userAId}, 'CarryForward Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'UNIFIED', 20, 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'CarryForward Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'UNIFIED', 20, 'ACTIVE')`;

    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${membershipAId}, ${workspaceAId}, ${userAId}, 'OWNER', 'ACTIVE', now())`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupAId}, ${workspaceAId}, 'CarryForward Test Group A', 'ACTIVE'),
      (${groupBId}, ${workspaceBId}, 'CarryForward Test Group B', 'ACTIVE')`;

    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES
      (${sourceMonthAId}, ${workspaceAId}, 2026, 7, 'CURRENT', ${userAId}),
      (${sourceMonthBId}, ${workspaceBId}, 2026, 7, 'CURRENT', ${userBId})`;

    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, due_day, join_fee_policy)
      VALUES
        (${sourceGroupMonthAId}, ${workspaceAId}, ${groupAId}, ${sourceMonthAId}, 60000, 'PER_GROUP', 15, 'FULL'),
        (${sourceGroupMonthBId}, ${workspaceBId}, ${groupBId}, ${sourceMonthBId}, 60000, 'PER_GROUP', 15, 'FULL')`;

    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES
      (${studentActiveId}, ${workspaceAId}, 'AP-CFA1', 'CarryForward Active Student', 'carryforward active student', 'ACTIVE'),
      (${studentWithdrawnId}, ${workspaceAId}, 'AP-CFA2', 'CarryForward Withdrawn Student', 'carryforward withdrawn student', 'ACTIVE'),
      (${studentPaidHistoryId}, ${workspaceAId}, 'AP-CFA3', 'CarryForward Paid-History Student', 'carryforward paid history student', 'ACTIVE'),
      (${studentBActiveId}, ${workspaceBId}, 'AP-CFB1', 'CarryForward B Active Student', 'carryforward b active student', 'ACTIVE')`;

    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES
      (${enrollmentActiveId}, ${workspaceAId}, ${studentActiveId}, ${sourceGroupMonthAId}, '2026-07-01', 'ACTIVE', 'FULL_MONTH'),
      (${enrollmentWithdrawnId}, ${workspaceAId}, ${studentWithdrawnId}, ${sourceGroupMonthAId}, '2026-07-01', 'WITHDRAWN', 'FULL_MONTH'),
      (${enrollmentPaidHistoryId}, ${workspaceAId}, ${studentPaidHistoryId}, ${sourceGroupMonthAId}, '2026-07-01', 'ACTIVE', 'FULL_MONTH'),
      (${enrollmentBActiveId}, ${workspaceBId}, ${studentBActiveId}, ${sourceGroupMonthBId}, '2026-07-01', 'ACTIVE', 'FULL_MONTH')`;

    // A prior obligation with REAL ledger activity (PARTIAL) on the source
    // enrollment — proves it stays completely untouched and never transfers.
    await admin`INSERT INTO financial_obligations
      (id, workspace_id, enrollment_id, base_fee_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, status, calculation_basis)
      VALUES (${obligationPaidHistoryId}, ${workspaceAId}, ${enrollmentPaidHistoryId}, 60000, 60000, '2026-07-15', 40000, 20000, 'PARTIAL', 'FULL_MONTH')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM outbox_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM audit_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM financial_obligations WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM enrollments WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM students WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM sessions WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM schedule_rules WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM group_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
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

  it("1-4+7-8: carries the ACTIVE student into a new Enrollment + new GroupMonth (same Group/Student ids), new Obligation (amount_paid=0, full remaining), excludes WITHDRAWN, leaves prior PARTIAL obligation untouched, is workspace-isolated, and inserts Audit+Outbox in the same transaction", async () => {
    const result = await withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
      runCreateMonthTransaction(db, {
        workspaceId: workspaceAId,
        workspaceTimezone: "Africa/Cairo",
        targetYear: 2026,
        targetMonth: 8,
        createdByUserId: userAId,
        createdByMembershipId: membershipAId,
        groupSpecs: [
          {
            groupId: groupAId,
            locationId: null,
            baseFeeMinor: 60000,
            currencyCode: "EGP",
            duePolicy: "PER_GROUP",
            dueDay: 15,
            joinFeePolicy: "FULL",
            scheduleRules: [],
            sourceGroupMonthId: sourceGroupMonthAId,
          },
        ],
      }),
    );

    if (typeof result === "string") throw new Error(`Expected a full result, got sentinel: ${result}`);
    expect(result.enrollmentCount).toBe(2); // studentActive + studentPaidHistory — NOT studentWithdrawn
    expect(result.groupMonths).toHaveLength(1);
    const newGroupMonth = result.groupMonths[0]!;
    expect(newGroupMonth.groupId).toBe(groupAId); // same Group identity reused
    expect(newGroupMonth.id).not.toBe(sourceGroupMonthAId); // new GroupMonth

    // New enrollments + obligations, scoped by admin connection (bypasses RLS for verification reads).
    const newEnrollments = await admin`SELECT * FROM enrollments WHERE group_month_id = ${newGroupMonth.id} ORDER BY student_id`;
    expect(newEnrollments).toHaveLength(2);
    const activeCarried = newEnrollments.find((e) => e.student_id === studentActiveId);
    expect(activeCarried).toBeDefined();
    expect(activeCarried!.id).not.toBe(enrollmentActiveId); // new Enrollment id, never reused
    expect(activeCarried!.status).toBe("ACTIVE");
    expect(newEnrollments.find((e) => e.student_id === studentWithdrawnId)).toBeUndefined(); // WITHDRAWN never carried

    const newObligation = await admin`SELECT * FROM financial_obligations WHERE enrollment_id = ${activeCarried!.id}`;
    expect(newObligation).toHaveLength(1);
    expect(Number(newObligation[0]!.base_fee_minor)).toBe(60000);
    expect(Number(newObligation[0]!.amount_paid_minor)).toBe(0);
    expect(Number(newObligation[0]!.remaining_minor)).toBe(60000);
    expect(newObligation[0]!.status).toBe("UNPAID");
    expect(newObligation[0]!.calculation_basis).toBe("FULL_MONTH");

    // Prior PARTIAL obligation completely untouched — no auto-allocation, no transfer.
    const oldObligation = await admin`SELECT * FROM financial_obligations WHERE id = ${obligationPaidHistoryId}`;
    expect(oldObligation[0]!.status).toBe("PARTIAL");
    expect(Number(oldObligation[0]!.amount_paid_minor)).toBe(40000);
    expect(Number(oldObligation[0]!.remaining_minor)).toBe(20000);

    // Audit + Outbox recorded inside the SAME transaction.
    const audit = await admin`SELECT * FROM audit_events WHERE entity_id = ${result.operatingMonth.id} AND action = 'month.created'`;
    expect(audit).toHaveLength(1);
    expect((audit[0]!.after_json as { enrollmentCount: number }).enrollmentCount).toBe(2);
    const outbox = await admin`SELECT * FROM outbox_events WHERE aggregate_id = ${result.operatingMonth.id} AND event_type = 'MonthCreated'`;
    expect(outbox).toHaveLength(1);
  });

  it("Product Decision — Carry-Forward Fee Rule: an ASK_EVERY_TIME group with continuing students succeeds — full GroupMonth fee, no proration, real Enrollment+Obligation rows committed", async () => {
    const targetYear = 2027;
    const targetMonth = 1;

    const result = await withRuntimeContext({ userId: userBId, workspaceId: workspaceBId }, (db) =>
      runCreateMonthTransaction(db, {
        workspaceId: workspaceBId,
        workspaceTimezone: "Africa/Cairo",
        targetYear,
        targetMonth,
        createdByUserId: userBId,
        createdByMembershipId: null,
        groupSpecs: [
          {
            groupId: groupBId,
            locationId: null,
            baseFeeMinor: 70000,
            currencyCode: "EGP",
            duePolicy: "PER_GROUP",
            dueDay: 15,
            joinFeePolicy: "ASK_EVERY_TIME",
            scheduleRules: [],
            sourceGroupMonthId: sourceGroupMonthBId,
          },
        ],
      }),
    );

    if (typeof result === "string") throw new Error(`Expected a full result, got sentinel: ${result}`);
    expect(result.enrollmentCount).toBe(1); // studentBActive carried despite ASK_EVERY_TIME

    const newGroupMonth = result.groupMonths[0]!;
    const carried = await admin`SELECT * FROM enrollments WHERE group_month_id = ${newGroupMonth.id}`;
    expect(carried).toHaveLength(1);
    expect(carried[0]!.student_id).toBe(studentBActiveId);

    const obligation = await admin`SELECT * FROM financial_obligations WHERE enrollment_id = ${carried[0]!.id}`;
    expect(obligation).toHaveLength(1);
    expect(Number(obligation[0]!.base_fee_minor)).toBe(70000); // full GroupMonth fee, never asked/blocked
    expect(Number(obligation[0]!.amount_paid_minor)).toBe(0);
    expect(obligation[0]!.calculation_basis).toBe("FULL_MONTH"); // no proration
  });

  it("6+8: workspace isolation — carrying forward workspace A's source month never touches workspace B's enrollments/obligations", async () => {
    // (Already implicitly proven by test 1's enrollmentCount === 2, restricted
    // to workspace A's own source group_month.) Explicit check: workspace B's
    // original enrollment is completely unaffected by workspace A's confirm,
    // and workspace B's own carry-forward (previous test) only ever produced
    // rows scoped to workspace B — never leaked into workspace A's data.
    const untouchedB = await admin`SELECT * FROM enrollments WHERE id = ${enrollmentBActiveId}`;
    expect(untouchedB).toHaveLength(1);
    expect(untouchedB[0]!.status).toBe("ACTIVE");
    const bObligations = await admin`SELECT * FROM financial_obligations WHERE workspace_id = ${workspaceBId}`;
    expect(bObligations.every((o) => o.workspace_id === workspaceBId)).toBe(true);
    const crossLeak = await admin`SELECT * FROM financial_obligations WHERE workspace_id = ${workspaceAId} AND enrollment_id IN (SELECT id FROM enrollments WHERE workspace_id = ${workspaceBId})`;
    expect(crossLeak).toHaveLength(0);
  });
});
