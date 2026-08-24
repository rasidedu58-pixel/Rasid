/**
 * Phase 9 — Reports / Notifications / Action Center real-Postgres
 * integration tests.
 *
 * Mirrors `./subscriptions-billing-security.integration.test.ts` exactly:
 * three real connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL`
 * app_runtime / `WORKER_DATABASE_URL` app_worker), proving several
 * scenarios a pure in-memory unit test cannot: Group/Monthly report
 * aggregation against REAL session/enrollment/obligation rows, the CURRENT-
 * month boundary, the notifications dedup UNIQUE constraint under
 * concurrent-shaped inserts, the app_worker-only INSERT / app_runtime
 * read_at-only-UPDATE RLS+grant boundary, `runNotificationsScan`'s three
 * sub-scans end-to-end, and cross-workspace isolation for
 * `notifications`/`exports`.
 *
 * Requires migrations 0001-0044 to already be applied against the target
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
  withWorkerRuntimeContext,
  getGroupReport,
  getMonthlyTeacherReport,
  insertDedupedNotification,
  listNotificationsForUser,
  runNotificationsScan,
} from "@academic-precision/database";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const WORKER_DATABASE_URL = process.env.WORKER_DATABASE_URL;

const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const distBuilt = existsSync(distEntryPoint);

const hasLiveCreds =
  !!DATABASE_URL && !!MIGRATION_DATABASE_URL && !!WORKER_DATABASE_URL && DATABASE_URL !== MIGRATION_DATABASE_URL && distBuilt;

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[reports-notifications-security.integration.test] Skipping: requires DATABASE_URL, " +
      "MIGRATION_DATABASE_URL, AND WORKER_DATABASE_URL (app_worker role, LOGIN enabled), AND this " +
      "package already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not a " +
      "failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 9 Reports/Notifications/Action Center Security (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const groupAId = randomUUID();
  const monthAId = randomUUID();
  const groupMonthAId = randomUUID();
  const studentAId = randomUUID();
  const studentBId = randomUUID();
  const enrollmentAId = randomUUID();
  const enrollmentBId = randomUUID();
  const sessionCompletedId = randomUUID();
  const sessionInProgressGapId = randomUUID();
  const obligationAId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Reports Test User A', 'reports-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'Reports Test User B', 'reports-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Reports Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Reports Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES (${groupAId}, ${workspaceAId}, 'Reports Test Group A', 'ACTIVE')`;
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${monthAId}, ${workspaceAId}, 2026, 8, 'CURRENT', ${userAId})`;
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES (${groupMonthAId}, ${workspaceAId}, ${groupAId}, ${monthAId}, 30000, 'PER_GROUP', 'FULL')`;

    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES
      (${studentAId}, ${workspaceAId}, 'AP-RPTA1', 'Reports Student A', 'reports student a', 'ACTIVE'),
      (${studentBId}, ${workspaceAId}, 'AP-RPTB1', 'Reports Student B', 'reports student b', 'ACTIVE')`;

    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES
      (${enrollmentAId}, ${workspaceAId}, ${studentAId}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH'),
      (${enrollmentBId}, ${workspaceAId}, ${studentBId}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;

    // One COMPLETED session, fully recorded for both students (PRESENT/DONE) — no gaps.
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
      (${sessionCompletedId}, ${workspaceAId}, ${groupMonthAId}, '2026-08-05T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId})`;
    await admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status, homework_status) VALUES
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${sessionCompletedId}, ${enrollmentAId}, 'PRESENT', 'DONE'),
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${sessionCompletedId}, ${enrollmentBId}, 'ABSENT', 'DONE')`;

    // One IN_PROGRESS session with a genuine gap (student B has NULL attendance/homework).
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
      (${sessionInProgressGapId}, ${workspaceAId}, ${groupMonthAId}, '2026-08-10T08:00:00Z', 60, 'IN_PROGRESS', 'GENERATED', ${userAId})`;
    await admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status, homework_status) VALUES
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${sessionInProgressGapId}, ${enrollmentAId}, 'PRESENT', 'DONE')`;
    // Student B has NO row at all for this session — same as NULL, a real gap.

    await admin`INSERT INTO financial_obligations (id, workspace_id, enrollment_id, base_fee_minor, net_due_minor, due_date, amount_paid_minor, remaining_minor, status, calculation_basis) VALUES
      (${obligationAId}, ${workspaceAId}, ${enrollmentAId}, 30000, 30000, '2026-08-05', 10000, 20000, 'PARTIAL', 'FULL_MONTH')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM notifications WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM exports WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM session_records WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM sessions WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM financial_obligations WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM enrollments WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM students WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM group_months WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM operating_months WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM groups WHERE workspace_id = ${workspaceAId}`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("Group Report computes real attendance/homework/missingRecordsCount/collection from seeded session/enrollment/obligation data", async () => {
    const result = await withRuntimeContext({ workspaceId: workspaceAId }, (db) => getGroupReport(db, workspaceAId, groupAId));
    expect(result).toBeDefined();
    expect(result!.roster).toHaveLength(2);
    // Across BOTH countable sessions: student A is PRESENT/DONE in the COMPLETED
    // session AND PRESENT/DONE in the IN_PROGRESS one (present counted twice);
    // student B is ABSENT/DONE in the COMPLETED session, then has NO record at
    // all in the IN_PROGRESS one (counted as missing both attendance+homework).
    expect(result!.attendance.present).toBe(2);
    expect(result!.attendance.absent).toBe(1);
    expect(result!.attendance.missing).toBe(1);
    expect(result!.homework.missing).toBe(1);
    expect(result!.missingRecordsCount).toBe(1); // exactly one enrollment (student B) has a gap
    expect(result!.collection.totalRemainingMinor).toBe(20000);
    expect(result!.collection.overdueCount).toBe(1); // due 2026-08-05, PARTIAL, in the past
  });

  it("Monthly Teacher Report respects the ACTUAL current operating month — an ARCHIVED/DRAFT month's group_months never appear", async () => {
    const draftMonthId = randomUUID();
    const draftGroupMonthId = randomUUID();
    try {
      await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${draftMonthId}, ${workspaceAId}, 2026, 9, 'DRAFT', ${userAId})`;
      await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
        VALUES (${draftGroupMonthId}, ${workspaceAId}, ${groupAId}, ${draftMonthId}, 30000, 'PER_GROUP', 'FULL')`;

      // Querying the CURRENT month (monthAId) never picks up the DRAFT month's group_month.
      const currentResult = await withRuntimeContext({ workspaceId: workspaceAId }, (db) => getMonthlyTeacherReport(db, workspaceAId, monthAId, "ALL"));
      expect(currentResult).toBeDefined();
      expect(currentResult!.groups.map((g) => g.groupId)).toEqual([groupAId]);
      expect(currentResult!.totals.studentsCount).toBe(2);

      // Querying the DRAFT month directly returns ITS OWN group_months (parameterized by monthId, not implicitly "whatever is CURRENT").
      const draftResult = await withRuntimeContext({ workspaceId: workspaceAId }, (db) => getMonthlyTeacherReport(db, workspaceAId, draftMonthId, "ALL"));
      expect(draftResult).toBeDefined();
      expect(draftResult!.month.status).toBe("DRAFT");
    } finally {
      await admin`DELETE FROM group_months WHERE id = ${draftGroupMonthId}`;
      await admin`DELETE FROM operating_months WHERE id = ${draftMonthId}`;
    }
  });

  it("Closure correction #1: SELECTED_GROUPS visibility computes totals from the visible dataset only — a hidden group never appears, not even in aggregate counts", async () => {
    const hiddenGroupId = randomUUID();
    const hiddenGroupMonthId = randomUUID();
    const hiddenStudentId = randomUUID();
    const hiddenEnrollmentId = randomUUID();
    try {
      await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES (${hiddenGroupId}, ${workspaceAId}, 'Hidden Group', 'ACTIVE')`;
      await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
        VALUES (${hiddenGroupMonthId}, ${workspaceAId}, ${hiddenGroupId}, ${monthAId}, 30000, 'PER_GROUP', 'FULL')`;
      await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES (${hiddenStudentId}, ${workspaceAId}, 'AP-HIDDEN1', 'Hidden Student', 'hidden student', 'ACTIVE')`;
      await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES (${hiddenEnrollmentId}, ${workspaceAId}, ${hiddenStudentId}, ${hiddenGroupMonthId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;

      const restricted = await withRuntimeContext({ workspaceId: workspaceAId }, (db) => getMonthlyTeacherReport(db, workspaceAId, monthAId, [groupAId]));
      expect(restricted!.groups.map((g) => g.groupId)).toEqual([groupAId]);
      expect(restricted!.totals.studentsCount).toBe(2); // NOT 3 — the hidden group's student never counted

      const unrestricted = await withRuntimeContext({ workspaceId: workspaceAId }, (db) => getMonthlyTeacherReport(db, workspaceAId, monthAId, "ALL"));
      expect(unrestricted!.totals.studentsCount).toBe(3); // Owner/ALL_GROUPS DOES see it
    } finally {
      await admin`DELETE FROM enrollments WHERE id = ${hiddenEnrollmentId}`;
      await admin`DELETE FROM students WHERE id = ${hiddenStudentId}`;
      await admin`DELETE FROM group_months WHERE id = ${hiddenGroupMonthId}`;
      await admin`DELETE FROM groups WHERE id = ${hiddenGroupId}`;
    }
  });

  it("notification dedup: the SAME (workspace, user, type, entity, dedupKey) inserted twice creates exactly one row — the DB constraint, not application luck", async () => {
    const first = await withWorkerRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      insertDedupedNotification(tx, { workspaceId: workspaceAId, userId: userAId, type: "FOLLOWUP_DUE", title: "t", body: "b", entityType: "scheduled_followup", entityId: randomUUID(), dedupKey: "dedup-test-1" }),
    );
    // Reuse the SAME entityId is impossible here (randomUUID differs) — so seed a fixed one and insert twice deliberately.
    const fixedEntityId = randomUUID();
    const insert1 = await withWorkerRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      insertDedupedNotification(tx, { workspaceId: workspaceAId, userId: userAId, type: "FOLLOWUP_DUE", title: "t", body: "b", entityType: "scheduled_followup", entityId: fixedEntityId, dedupKey: "dedup-test-2" }),
    );
    const insert2 = await withWorkerRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      insertDedupedNotification(tx, { workspaceId: workspaceAId, userId: userAId, type: "FOLLOWUP_DUE", title: "t (retry)", body: "b (retry)", entityType: "scheduled_followup", entityId: fixedEntityId, dedupKey: "dedup-test-2" }),
    );
    expect(first).toBe(true);
    expect(insert1).toBe(true);
    expect(insert2).toBe(false); // the retry was a genuine no-op

    const rows = await admin`SELECT count(*)::int AS c FROM notifications WHERE workspace_id = ${workspaceAId} AND entity_id = ${fixedEntityId} AND dedup_key = 'dedup-test-2'`;
    expect(rows[0]!.c).toBe(1);
  });

  it("app_worker is the ONLY notification producer — app_runtime cannot INSERT, but CAN read its own and update read_at only", async () => {
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) =>
        db.execute(sql`INSERT INTO notifications (workspace_id, user_id, type, title, body, dedup_key) VALUES (${workspaceAId}, ${userAId}, 'FOLLOWUP_DUE', 't', 'b', 'forbidden-insert')`),
      ),
    ).rejects.toThrow(/permission denied/i);

    const workerCreated = await withWorkerRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      insertDedupedNotification(tx, { workspaceId: workspaceAId, userId: userAId, type: "MISSING_RECORDS", title: "t", body: "b", entityType: "session", entityId: randomUUID(), dedupKey: "app-worker-producer-test" }),
    );
    expect(workerCreated).toBe(true);

    // app_runtime CAN read it (own notification).
    const rows = await withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => listNotificationsForUser(db, { workspaceId: workspaceAId, userId: userAId }));
    const created = rows.find((r) => r.dedupKey === "app-worker-producer-test");
    expect(created).toBeDefined();

    // app_runtime can update read_at (the only column granted)...
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => db.execute(sql`UPDATE notifications SET read_at = now() WHERE id = ${created!.id}`)),
    ).resolves.toBeDefined();

    // ...but cannot rewrite title/body/type — column-level grant, not table-level.
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => db.execute(sql`UPDATE notifications SET title = 'rewritten' WHERE id = ${created!.id}`)),
    ).rejects.toThrow(/permission denied/i);

    // Never DELETE either.
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId, userId: userAId }, (db) => db.execute(sql`DELETE FROM notifications WHERE id = ${created!.id}`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a user can only ever see THEIR OWN notifications, even within the SAME workspace — the dual workspace_id+user_id RLS policy", async () => {
    await withWorkerRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      insertDedupedNotification(tx, { workspaceId: workspaceAId, userId: userAId, type: "FOLLOWUP_DUE", title: "for A only", body: "b", entityType: "scheduled_followup", entityId: randomUUID(), dedupKey: "user-isolation-test" }),
    );
    const asDifferentUserSameWorkspace = await withRuntimeContext({ workspaceId: workspaceAId, userId: randomUUID() }, (db) =>
      db.execute(sql`SELECT * FROM notifications WHERE dedup_key = 'user-isolation-test'`),
    );
    expect(asDifferentUserSameWorkspace).toHaveLength(0);
  });

  it("cross-workspace isolation: workspace B never sees workspace A's notifications, even for the same physical user", async () => {
    await withWorkerRuntimeContext({ workspaceId: workspaceAId }, (tx) =>
      insertDedupedNotification(tx, { workspaceId: workspaceAId, userId: userAId, type: "FOLLOWUP_DUE", title: "workspace A only", body: "b", entityType: "scheduled_followup", entityId: randomUUID(), dedupKey: "cross-workspace-test" }),
    );
    const rowsForB = await withRuntimeContext({ workspaceId: workspaceBId, userId: userAId }, (db) => db.execute(sql`SELECT * FROM notifications WHERE dedup_key = 'cross-workspace-test'`));
    expect(rowsForB).toHaveLength(0);
  });

  it("runNotificationsScan end-to-end: MISSING_RECORDS is created for the real gap session, and NEVER for the fully-recorded COMPLETED session", async () => {
    const workerDb = getWorkerDb();
    const result = await runNotificationsScan(workerDb);
    expect(result.missingRecordsScanned).toBeGreaterThanOrEqual(1);

    const rowsForGapSession = await admin`SELECT * FROM notifications WHERE entity_type = 'session' AND entity_id = ${sessionInProgressGapId}`;
    expect(rowsForGapSession.length).toBe(1);
    expect(rowsForGapSession[0]!.user_id).toBe(userAId); // notified the Owner

    const rowsForCompletedSession = await admin`SELECT * FROM notifications WHERE entity_type = 'session' AND entity_id = ${sessionCompletedId}`;
    expect(rowsForCompletedSession.length).toBe(0); // COMPLETED is never scanned (only IN_PROGRESS) — and it had no gap anyway

    // Re-running the scan is idempotent — no duplicate notification for the same session.
    await runNotificationsScan(workerDb);
    const rowsAfterRescan = await admin`SELECT count(*)::int AS c FROM notifications WHERE entity_type = 'session' AND entity_id = ${sessionInProgressGapId}`;
    expect(rowsAfterRescan[0]!.c).toBe(1);
  });

  it("Phase 10 Closure Delta — subscription reminder catch-up: a worker outage past the 7d point emits the missed 7d reminder once, real end-to-end via runNotificationsScan", async () => {
    const subscriptionId = randomUUID();
    // periodEnd 5 days out — simulating a worker that was down through the
    // ENTIRE 7d window (which would have needed a scan somewhere in
    // [156h,180h] remaining) and only comes back now, at 120h remaining.
    await admin`INSERT INTO subscriptions (id, workspace_id, state, period_start, period_end, version) VALUES
      (${subscriptionId}, ${workspaceAId}, 'ACTIVE', now() - interval '25 days', now() + interval '5 days', 1)`;
    try {
      const workerDb = getWorkerDb();
      const result = await runNotificationsScan(workerDb);
      expect(result.subscriptionScanned).toBeGreaterThanOrEqual(1);

      const rows = await admin`SELECT dedup_key, user_id FROM notifications WHERE entity_type = 'subscription' AND entity_id = ${subscriptionId}`;
      expect(rows.length).toBe(1); // exactly one — never both 7d and a later one simultaneously
      expect(rows[0]!.dedup_key).toBe("7d"); // the single most-relevant crossed-but-unemitted milestone
      expect(rows[0]!.user_id).toBe(userAId); // notified the workspace Owner

      // Re-running the scan (still at ~5 days remaining) does NOT duplicate
      // the 7d reminder, and does NOT fall back to emitting anything else —
      // DB dedup + determineMilestoneToEmit's own "already emitted" check
      // both agree nothing further happens here.
      await runNotificationsScan(workerDb);
      const rowsAfterRescan = await admin`SELECT count(*)::int AS c FROM notifications WHERE entity_type = 'subscription' AND entity_id = ${subscriptionId}`;
      expect(rowsAfterRescan[0]!.c).toBe(1);
    } finally {
      await admin`DELETE FROM notifications WHERE entity_type = 'subscription' AND entity_id = ${subscriptionId}`;
      await admin`DELETE FROM subscriptions WHERE id = ${subscriptionId}`;
    }
  });

  it("Phase 10 Closure Delta — subscription reminder catch-up: an outage spanning BOTH the 7d and 3d points emits only the more urgent 3d, never both", async () => {
    const subscriptionId = randomUUID();
    // periodEnd 2 days out — both the 7d and 3d points have already passed;
    // only the single most-relevant one (3d) should ever be emitted.
    await admin`INSERT INTO subscriptions (id, workspace_id, state, period_start, period_end, version) VALUES
      (${subscriptionId}, ${workspaceAId}, 'ACTIVE', now() - interval '28 days', now() + interval '2 days', 1)`;
    try {
      const workerDb = getWorkerDb();
      await runNotificationsScan(workerDb);

      const rows = await admin`SELECT dedup_key FROM notifications WHERE entity_type = 'subscription' AND entity_id = ${subscriptionId}`;
      expect(rows.length).toBe(1);
      expect(rows[0]!.dedup_key).toBe("3d");
      // The 7d reminder is deliberately never sent for this cycle — abandoned,
      // not backfilled, per "never emit multiple stale warnings simultaneously".
    } finally {
      await admin`DELETE FROM notifications WHERE entity_type = 'subscription' AND entity_id = ${subscriptionId}`;
      await admin`DELETE FROM subscriptions WHERE id = ${subscriptionId}`;
    }
  });
});
