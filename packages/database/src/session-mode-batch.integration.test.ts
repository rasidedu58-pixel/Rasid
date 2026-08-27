/**
 * Phase 15D.1 — real-Postgres integration test for the session-mode BULK
 * record upsert (attendance / homework / exam batches now issue ONE
 * multi-row `INSERT ... ON CONFLICT DO UPDATE` instead of N per-row
 * round-trips). These assertions pin the exact semantics the optimization
 * had to preserve, executed by a real Postgres engine (not a mock):
 *
 *  - partial-field independence (a homework batch never disturbs
 *    attendance_status / exam_*, and vice versa),
 *  - first-insert column defaults (exam_status = NO_EXAM, others NULL),
 *  - ABSENT_FROM_EXAM writes exam_score = NULL while SCORED writes the score,
 *  - per-record `version + 1` and a single `sessions.version` bump per batch,
 *  - duplicate enrollmentIds in one payload collapse last-write-wins (no
 *    "cannot affect row a second time" error),
 *  - a stale expectedVersion is an atomic VERSION_CONFLICT — nothing written.
 *
 * Gated on `MIGRATION_DATABASE_URL` (an admin/superuser connection) + a prior
 * `pnpm build`. Unlike the *-security integration suites this does NOT need a
 * distinct app_runtime `DATABASE_URL`: the bulk upsert's correctness is a
 * pure SQL-semantics property independent of RLS (RLS is untouched by this
 * change and is covered by session-mode-security.integration.test.ts). The
 * batch functions accept the `db` handle as their first argument, so they run
 * against a drizzle instance built directly on the admin connection.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyAttendanceBatchTransaction,
  applyHomeworkBatchTransaction,
  applyExamScoresBatchTransaction,
  isBatchFailure,
  VERSION_CONFLICT,
} from "@academic-precision/database";

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const hasLiveCreds = !!MIGRATION_DATABASE_URL && existsSync(distEntryPoint);

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn(
    "[session-mode-batch.integration.test] Skipping: requires MIGRATION_DATABASE_URL (admin) AND a " +
      "prior `pnpm build` (dist/index.js). Not a failure — expected to skip in offline sandboxes.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 15D.1 session-mode bulk upsert (live Postgres)", () => {
  let admin: Sql;
  let db: ReturnType<typeof drizzle>;

  const workspaceId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const groupId = randomUUID();
  const monthId = randomUUID();
  const groupMonthId = randomUUID();
  const studentIds = [randomUUID(), randomUUID(), randomUUID()];
  const enrollmentIds = [randomUUID(), randomUUID(), randomUUID()];
  const sessionId = randomUUID();

  const recordFor = (enrollmentId: string) =>
    admin`SELECT attendance_status, homework_status, exam_status, exam_score, version
          FROM session_records WHERE session_id = ${sessionId} AND enrollment_id = ${enrollmentId}`.then((r) => r[0]);
  const sessionVersion = () =>
    admin`SELECT version FROM sessions WHERE id = ${sessionId}`.then((r) => Number(r[0]!.version));

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });
    db = drizzle(admin);

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userId}, 'Batch Test Owner', 'batch-test-owner@example.test', 'ACTIVE')`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status)
      VALUES (${workspaceId}, ${userId}, 'Batch Test Workspace', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at)
      VALUES (${membershipId}, ${workspaceId}, ${userId}, 'OWNER', 'ACTIVE', now())`;
    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES (${groupId}, ${workspaceId}, 'Batch Test Group', 'ACTIVE')`;
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by)
      VALUES (${monthId}, ${workspaceId}, 2026, 8, 'CURRENT', ${userId})`;
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES (${groupMonthId}, ${workspaceId}, ${groupId}, ${monthId}, 60000, 'PER_GROUP', 'FULL')`;
    for (let i = 0; i < studentIds.length; i += 1) {
      await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status)
        VALUES (${studentIds[i]}, ${workspaceId}, ${"AP-BAT" + i}, ${"Batch Student " + i}, ${"batch student " + i}, 'ACTIVE')`;
      await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
        VALUES (${enrollmentIds[i]}, ${workspaceId}, ${studentIds[i]}, ${groupMonthId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;
    }
    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by)
      VALUES (${sessionId}, ${workspaceId}, ${groupMonthId}, '2026-08-10T08:00:00Z', 60, 'IN_PROGRESS', 'GENERATED', ${userId})`;
  }, 60_000); // generous hook timeout: many sequential inserts over the pooler

  afterAll(async () => {
    try {
      await admin`DELETE FROM session_records WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM session_exams WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM sessions WHERE id = ${sessionId}`;
      await admin`DELETE FROM enrollments WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM students WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM group_months WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM operating_months WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM groups WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM memberships WHERE workspace_id = ${workspaceId}`;
      await admin`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await admin`DELETE FROM users WHERE id = ${userId}`;
    } finally {
      await admin.end({ timeout: 5 });
    }
  }, 60_000);

  it("attendance batch creates rows with correct defaults, bumps session.version once, and each record.version to 1", async () => {
    const res = await applyAttendanceBatchTransaction(db, {
      sessionId,
      workspaceId,
      groupMonthId,
      expectedVersion: 1,
      actorUserId: userId,
      records: [
        { enrollmentId: enrollmentIds[0]!, status: "PRESENT" },
        { enrollmentId: enrollmentIds[1]!, status: "ABSENT" },
        { enrollmentId: enrollmentIds[2]!, status: "LATE" },
      ],
    });
    expect(isBatchFailure(res)).toBe(false);
    expect(await sessionVersion()).toBe(2); // one bump for the whole batch

    const r0 = await recordFor(enrollmentIds[0]!);
    expect(r0.attendance_status).toBe("PRESENT");
    expect(r0.homework_status).toBeNull(); // untouched default
    expect(r0.exam_status).toBe("NO_EXAM"); // insert default
    expect(r0.exam_score).toBeNull();
    expect(Number(r0.version)).toBe(1);
    expect((await recordFor(enrollmentIds[1]!)).attendance_status).toBe("ABSENT");
  });

  it("homework batch updates ONLY homework_status, leaving the recorded attendance untouched (partial-field independence)", async () => {
    const res = await applyHomeworkBatchTransaction(db, {
      sessionId,
      workspaceId,
      groupMonthId,
      expectedVersion: 2,
      actorUserId: userId,
      records: [
        { enrollmentId: enrollmentIds[0]!, status: "DONE" },
        { enrollmentId: enrollmentIds[1]!, status: "NOT_DONE" },
      ],
    });
    expect(isBatchFailure(res)).toBe(false);

    const r0 = await recordFor(enrollmentIds[0]!);
    expect(r0.homework_status).toBe("DONE");
    expect(r0.attendance_status).toBe("PRESENT"); // preserved from the attendance batch
    expect(r0.exam_status).toBe("NO_EXAM");
    expect(Number(r0.version)).toBe(2); // bumped again on this row (conflict update)
    // A row NOT in this homework batch keeps its attendance and unchanged version.
    const r2 = await recordFor(enrollmentIds[2]!);
    expect(r2.homework_status).toBeNull();
    expect(r2.attendance_status).toBe("LATE");
    expect(Number(r2.version)).toBe(1);
  });

  it("exam batch: SCORED writes the score, ABSENT_FROM_EXAM writes NULL, attendance/homework preserved", async () => {
    await admin`INSERT INTO session_exams (id, workspace_id, session_id, max_score, version)
      VALUES (${randomUUID()}, ${workspaceId}, ${sessionId}, 20, 1)`;

    const res = await applyExamScoresBatchTransaction(db, {
      sessionId,
      workspaceId,
      groupMonthId,
      expectedVersion: 3,
      actorUserId: userId,
      records: [
        { enrollmentId: enrollmentIds[0]!, status: "SCORED", score: 15 },
        { enrollmentId: enrollmentIds[1]!, status: "ABSENT_FROM_EXAM" },
      ],
    });
    expect(isBatchFailure(res)).toBe(false);

    const r0 = await recordFor(enrollmentIds[0]!);
    expect(r0.exam_status).toBe("SCORED");
    expect(Number(r0.exam_score)).toBe(15);
    expect(r0.attendance_status).toBe("PRESENT"); // preserved
    expect(r0.homework_status).toBe("DONE"); // preserved

    const r1 = await recordFor(enrollmentIds[1]!);
    expect(r1.exam_status).toBe("ABSENT_FROM_EXAM");
    expect(r1.exam_score).toBeNull();
    expect(r1.attendance_status).toBe("ABSENT");
  });

  it("duplicate enrollmentId in one payload collapses last-write-wins (single row, no error)", async () => {
    const before = await sessionVersion();
    const res = await applyAttendanceBatchTransaction(db, {
      sessionId,
      workspaceId,
      groupMonthId,
      expectedVersion: before,
      actorUserId: userId,
      records: [
        { enrollmentId: enrollmentIds[2]!, status: "PRESENT" },
        { enrollmentId: enrollmentIds[2]!, status: "ABSENT" }, // same enrollment again
      ],
    });
    expect(isBatchFailure(res)).toBe(false);
    const r2 = await recordFor(enrollmentIds[2]!);
    expect(r2.attendance_status).toBe("ABSENT"); // last write wins
    const count = await admin`SELECT count(*)::int AS n FROM session_records WHERE session_id = ${sessionId} AND enrollment_id = ${enrollmentIds[2]!}`;
    expect(count[0]!.n).toBe(1); // still exactly one row
  });

  it("a stale expectedVersion is an atomic VERSION_CONFLICT — nothing is written", async () => {
    const r0Before = await recordFor(enrollmentIds[0]!);
    const res = await applyAttendanceBatchTransaction(db, {
      sessionId,
      workspaceId,
      groupMonthId,
      expectedVersion: 1, // stale
      actorUserId: userId,
      records: [{ enrollmentId: enrollmentIds[0]!, status: "LATE" }],
    });
    expect(res).toBe(VERSION_CONFLICT);
    const r0After = await recordFor(enrollmentIds[0]!);
    expect(r0After.attendance_status).toBe(r0Before.attendance_status); // unchanged
    expect(Number(r0After.version)).toBe(Number(r0Before.version));
  });
});
