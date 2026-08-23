/**
 * Phase 7 — Attention/Follow-up real-Postgres integration tests.
 *
 * Mirrors `./carry-forward.integration.test.ts` exactly: two distinct real
 * connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL` app_runtime)
 * PLUS a THIRD, `WORKER_DATABASE_URL` connection authenticating as the
 * dedicated `app_worker` role (migrations/0032_app_worker_role.sql) —
 * exercises `processPendingOutboxEvents` against a real seeded
 * SessionCompleted event exactly the way `apps/worker`'s own polling loop
 * would, proving: the real rule engine fires end-to-end, reason/evidence
 * accumulate without duplication, reprocessing is idempotent, the
 * partial-unique "one active case" constraint holds, resolve-then-
 * recurrence opens a genuinely NEW case, RLS isolates workspaces, and
 * app_runtime structurally cannot write attention_reasons/attention_
 * evidence (worker-only tables per the split grants).
 *
 * Requires migrations 0008-0032 to already be applied against the target
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
  processPendingOutboxEvents,
  withRuntimeContext,
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
    "[attention-followup-security.integration.test] Skipping: requires DATABASE_URL, " +
      "MIGRATION_DATABASE_URL, AND WORKER_DATABASE_URL (app_worker role, LOGIN enabled), AND this " +
      "package already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not a " +
      "failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 7 Attention/Follow-up Security (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const groupAId = randomUUID();
  const groupBId = randomUUID();
  const monthAId = randomUUID();
  const monthBId = randomUUID();
  const groupMonthAId = randomUUID();
  const groupMonthBId = randomUUID();
  const studentAId = randomUUID();
  const studentBId = randomUUID();
  const enrollmentAId = randomUUID();
  const enrollmentBId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Attention Test User A', 'attention-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'Attention Test User B', 'attention-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Attention Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Attention Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupAId}, ${workspaceAId}, 'Attention Test Group A', 'ACTIVE'),
      (${groupBId}, ${workspaceBId}, 'Attention Test Group B', 'ACTIVE')`;

    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES
      (${monthAId}, ${workspaceAId}, 2026, 8, 'CURRENT', ${userAId}),
      (${monthBId}, ${workspaceBId}, 2026, 8, 'CURRENT', ${userBId})`;

    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES
        (${groupMonthAId}, ${workspaceAId}, ${groupAId}, ${monthAId}, 30000, 'PER_GROUP', 'FULL'),
        (${groupMonthBId}, ${workspaceBId}, ${groupBId}, ${monthBId}, 30000, 'PER_GROUP', 'FULL')`;

    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES
      (${studentAId}, ${workspaceAId}, 'AP-ATTA1', 'Attention Student A', 'attention student a', 'ACTIVE'),
      (${studentBId}, ${workspaceBId}, 'AP-ATTB1', 'Attention Student B', 'attention student b', 'ACTIVE')`;

    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES
      (${enrollmentAId}, ${workspaceAId}, ${studentAId}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH'),
      (${enrollmentBId}, ${workspaceBId}, ${studentBId}, ${groupMonthBId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM outbox_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM audit_events WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM attention_evidence WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM attention_reasons WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM attention_cases WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM session_records WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM session_exams WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM sessions WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM enrollments WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM students WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM group_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM operating_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM groups WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM workspaces WHERE id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM users WHERE id IN (${userAId}, ${userBId})`;
    } finally {
      await admin.end({ timeout: 5 });
      await closeDb();
    }
  });

  it("1-4+11: end-to-end SessionCompleted -> rule engine -> Case+Reason+Evidence, and reprocessing the SAME event is idempotent (no duplicates)", async () => {
    const session1Id = randomUUID();
    const session2Id = randomUUID();
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
      (${session1Id}, ${workspaceAId}, ${groupMonthAId}, '2026-08-04T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId}),
      (${session2Id}, ${workspaceAId}, ${groupMonthAId}, '2026-08-06T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId})`;
    await admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status) VALUES
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${session1Id}, ${enrollmentAId}, 'ABSENT'),
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${session2Id}, ${enrollmentAId}, 'ABSENT')`;

    const outboxId = randomUUID();
    await admin`INSERT INTO outbox_events (id, workspace_id, event_type, aggregate_type, aggregate_id, payload, status) VALUES
      (${outboxId}, ${workspaceAId}, 'SessionCompleted', 'Session', ${session2Id}, ${JSON.stringify({ sessionId: session2Id, groupMonthId: groupMonthAId, completedAt: new Date().toISOString() })}::jsonb, 'PENDING')`;

    const workerDb = getWorkerDb();
    const result1 = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 5 });
    expect(result1.processed).toBeGreaterThanOrEqual(1);
    expect(result1.failed).toBe(0);

    const cases = await admin`SELECT * FROM attention_cases WHERE workspace_id = ${workspaceAId} AND student_id = ${studentAId}`;
    expect(cases).toHaveLength(1);
    const caseId = cases[0]!.id as string;
    expect(cases[0]!.status).toBe("NEW");
    expect(cases[0]!.priority).toBe("MEDIUM");

    const reasons = await admin`SELECT * FROM attention_reasons WHERE attention_case_id = ${caseId}`;
    expect(reasons).toHaveLength(1);
    expect(reasons[0]!.rule_key).toBe("absence.consecutive");
    expect(reasons[0]!.group_id).toBe(groupAId); // group-aware — Group A produced this evidence

    const evidence = await admin`SELECT * FROM attention_evidence WHERE attention_reason_id = ${reasons[0]!.id}`;
    expect(evidence).toHaveLength(2);

    const outboxRow = await admin`SELECT status FROM outbox_events WHERE id = ${outboxId}`;
    expect(outboxRow[0]!.status).toBe("PROCESSED");

    const caseOpenedEvent = await admin`SELECT * FROM outbox_events WHERE aggregate_id = ${caseId} AND event_type = 'AttentionCaseOpened'`;
    expect(caseOpenedEvent).toHaveLength(1);

    // --- Idempotency: reset the SAME event back to PENDING and reprocess ---
    // `available_at` must also be reset — the first successful claim
    // advanced it to `now() + LEASE_MS` (the dispatcher's own lease
    // window), so a bare status reset would leave the row genuinely
    // ineligible for reclaim until that lease naturally expires.
    await admin`UPDATE outbox_events SET status = 'PENDING', attempt_count = 0, available_at = now() WHERE id = ${outboxId}`;
    const result2 = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 5 });
    expect(result2.processed).toBeGreaterThanOrEqual(1);

    const casesAfterReprocess = await admin`SELECT * FROM attention_cases WHERE workspace_id = ${workspaceAId} AND student_id = ${studentAId}`;
    expect(casesAfterReprocess).toHaveLength(1); // no duplicate case
    const reasonsAfterReprocess = await admin`SELECT * FROM attention_reasons WHERE attention_case_id = ${caseId}`;
    expect(reasonsAfterReprocess).toHaveLength(1); // no duplicate reason
    const evidenceAfterReprocess = await admin`SELECT * FROM attention_evidence WHERE attention_reason_id = ${reasons[0]!.id}`;
    expect(evidenceAfterReprocess).toHaveLength(2); // no duplicate evidence rows
  });

  it("3: the partial-unique index rejects a second non-CLOSED case for the same (workspace, student)", async () => {
    const existing = await admin`SELECT id FROM attention_cases WHERE workspace_id = ${workspaceAId} AND student_id = ${studentAId} AND status <> 'CLOSED'`;
    expect(existing.length).toBeGreaterThan(0);

    await expect(
      admin`INSERT INTO attention_cases (id, workspace_id, student_id, status, priority) VALUES (${randomUUID()}, ${workspaceAId}, ${studentAId}, 'NEW', 'MEDIUM')`,
    ).rejects.toThrow(/duplicate key|unique constraint/i);
  });

  it("5: resolve then recurrence — closing the case and a genuinely later qualifying session opens a BRAND NEW case, never reopening the old one", async () => {
    const before = await admin`SELECT id FROM attention_cases WHERE workspace_id = ${workspaceAId} AND student_id = ${studentAId} AND status <> 'CLOSED'`;
    const oldCaseId = before[0]!.id as string;
    await admin`UPDATE attention_cases SET status = 'CLOSED', closed_at = now() WHERE id = ${oldCaseId}`;

    const session3Id = randomUUID();
    const session4Id = randomUUID();
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
      (${session3Id}, ${workspaceAId}, ${groupMonthAId}, '2026-08-11T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId}),
      (${session4Id}, ${workspaceAId}, ${groupMonthAId}, '2026-08-13T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId})`;
    await admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status) VALUES
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${session3Id}, ${enrollmentAId}, 'ABSENT'),
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${session4Id}, ${enrollmentAId}, 'ABSENT')`;

    const outboxId = randomUUID();
    await admin`INSERT INTO outbox_events (id, workspace_id, event_type, aggregate_type, aggregate_id, payload, status) VALUES
      (${outboxId}, ${workspaceAId}, 'SessionCompleted', 'Session', ${session4Id}, ${JSON.stringify({ sessionId: session4Id, groupMonthId: groupMonthAId, completedAt: new Date().toISOString() })}::jsonb, 'PENDING')`;

    const workerDb = getWorkerDb();
    const result = await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 5 });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const activeCases = await admin`SELECT id FROM attention_cases WHERE workspace_id = ${workspaceAId} AND student_id = ${studentAId} AND status <> 'CLOSED'`;
    expect(activeCases).toHaveLength(1);
    expect(activeCases[0]!.id).not.toBe(oldCaseId); // a genuinely NEW case, old one stays CLOSED history

    const oldCaseStillClosed = await admin`SELECT status FROM attention_cases WHERE id = ${oldCaseId}`;
    expect(oldCaseStillClosed[0]!.status).toBe("CLOSED");
  });

  it("12: RLS cross-workspace isolation — workspace B never sees workspace A's Attention Cases/Reasons/Evidence, and vice versa", async () => {
    const rowsForA = await withRuntimeContext({ workspaceId: workspaceAId }, (db) => db.execute(sql`SELECT id FROM attention_cases`));
    const idsForA = rowsForA.map((r) => (r as { id: string }).id);
    expect(idsForA.length).toBeGreaterThan(0);

    const rowsForB = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT id FROM attention_cases WHERE student_id = ${studentAId}`),
    );
    expect(rowsForB).toHaveLength(0);

    const crossReasons = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM attention_reasons WHERE workspace_id = ${workspaceAId}`),
    );
    expect(crossReasons).toHaveLength(0);
  });

  it("app_runtime cannot write attention_reasons/attention_evidence — these are worker-only writes (structural grant boundary, 0031's split)", async () => {
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO attention_reasons (id, workspace_id, attention_case_id, group_id, rule_key, severity)
              VALUES (${randomUUID()}, ${workspaceAId}, ${randomUUID()}, ${groupAId}, 'absence.consecutive', 'MEDIUM')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      withRuntimeContext({ workspaceId: workspaceAId }, (db) => db.execute(sql`UPDATE attention_reasons SET severity = 'HIGH' WHERE true`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("app_runtime cannot UPDATE outbox_events — never widened beyond SELECT+INSERT (0024's original boundary, re-confirmed after Phase 7)", async () => {
    await expect(
      withRuntimeContext({ workspaceId: workspaceAId }, (db) => db.execute(sql`UPDATE outbox_events SET status = 'PROCESSED' WHERE true`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it("exam.low: two consecutive scores below their own exam's threshold trigger a Case; an exam with no threshold configured never does", async () => {
    const examSessionId1 = randomUUID();
    const examSessionId2 = randomUUID();
    const examSessionId3 = randomUUID();
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by) VALUES
      (${examSessionId1}, ${workspaceAId}, ${groupMonthAId}, '2026-08-18T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId}),
      (${examSessionId2}, ${workspaceAId}, ${groupMonthAId}, '2026-08-20T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId}),
      (${examSessionId3}, ${workspaceAId}, ${groupMonthAId}, '2026-08-22T08:00:00Z', 60, 'COMPLETED', 'GENERATED', ${userAId})`;
    // Exam 1: threshold configured, low score. Exam 2: NO threshold configured, low score (must NOT count). Exam 3: threshold configured, low score.
    await admin`INSERT INTO session_exams (id, workspace_id, session_id, max_score, low_score_threshold) VALUES
      (${randomUUID()}, ${workspaceAId}, ${examSessionId1}, 100, 50)`;
    await admin`INSERT INTO session_exams (id, workspace_id, session_id, max_score) VALUES
      (${randomUUID()}, ${workspaceAId}, ${examSessionId2}, 100)`;
    await admin`INSERT INTO session_exams (id, workspace_id, session_id, max_score, low_score_threshold) VALUES
      (${randomUUID()}, ${workspaceAId}, ${examSessionId3}, 100, 50)`;
    await admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, exam_status, exam_score) VALUES
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${examSessionId1}, ${enrollmentAId}, 'SCORED', 30),
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${examSessionId2}, ${enrollmentAId}, 'SCORED', 10),
      (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${examSessionId3}, ${enrollmentAId}, 'SCORED', 35)`;

    const outboxId = randomUUID();
    await admin`INSERT INTO outbox_events (id, workspace_id, event_type, aggregate_type, aggregate_id, payload, status) VALUES
      (${outboxId}, ${workspaceAId}, 'SessionCompleted', 'Session', ${examSessionId3}, ${JSON.stringify({ sessionId: examSessionId3, groupMonthId: groupMonthAId, completedAt: new Date().toISOString() })}::jsonb, 'PENDING')`;

    const workerDb = getWorkerDb();
    await processPendingOutboxEvents(workerDb, { eventTypes: ["SessionCompleted"], maxEvents: 5 });

    const activeCase = await admin`SELECT id FROM attention_cases WHERE workspace_id = ${workspaceAId} AND student_id = ${studentAId} AND status <> 'CLOSED'`;
    expect(activeCase.length).toBeGreaterThan(0);
    const examLowReason = await admin`SELECT * FROM attention_reasons WHERE attention_case_id = ${activeCase[0]!.id} AND rule_key = 'exam.low'`;
    expect(examLowReason).toHaveLength(1);
    // The last-two-eligible sequence is exam1 (threshold=50) and exam3 (threshold=50) — exam2 (no threshold) is skipped entirely.
    const examLowEvidence = await admin`SELECT source_id FROM attention_evidence WHERE attention_reason_id = ${examLowReason[0]!.id}`;
    const evidenceSessionIds = examLowEvidence.map((r) => r.source_id as string).sort();
    expect(evidenceSessionIds).toEqual([examSessionId1, examSessionId3].sort());
  });
});
