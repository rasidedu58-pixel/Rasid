/**
 * Phase 5 — Session Mode real-Postgres integration tests.
 *
 * Mirrors `./students-security.integration.test.ts` exactly: two distinct
 * real connections (`MIGRATION_DATABASE_URL` admin / `DATABASE_URL`
 * app_runtime), imports the COMPILED package entry point (`../dist/index.js`)
 * rather than raw TS source for the same dual-package-hazard reason
 * documented there, and self-skips entirely when live credentials + a prior
 * build aren't available.
 *
 * Requires migrations 0008-0022 to already be applied against the target
 * database.
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, withRuntimeContext } from "@academic-precision/database";

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
    "[session-mode-security.integration.test] Skipping: requires DATABASE_URL (app_runtime) and " +
      "MIGRATION_DATABASE_URL (postgres) set to distinct connection strings, AND this package " +
      "already built (`pnpm build` — dist/index.js must exist). Expected to skip in CI / " +
      "sandboxes without live Supabase credentials, and in a pre-build test run — this is not " +
      "a failure.",
  );
}

describe.skipIf(!hasLiveCreds)("Phase 5 Session Mode Security (live Postgres)", () => {
  let admin: Sql;

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const userAId = randomUUID();
  const userBId = randomUUID();
  const membershipAId = randomUUID();
  const membershipBId = randomUUID();
  const groupAId = randomUUID();
  const groupBId = randomUUID();
  const groupCId = randomUUID(); // second group, SAME workspace as A — for the cross-group (not cross-tenant) guard
  const monthAId = randomUUID();
  const monthBId = randomUUID();
  const groupMonthAId = randomUUID();
  const groupMonthBId = randomUUID();
  const groupMonthCId = randomUUID();
  const studentAId = randomUUID();
  const studentCId = randomUUID();
  const sessionAId = randomUUID();
  const sessionBId = randomUUID();
  const sessionCId = randomUUID();
  const enrollmentAId = randomUUID();
  const enrollmentCId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });

    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES
      (${userAId}, 'Session Mode Test User A', 'session-mode-test-a@example.test', 'ACTIVE'),
      (${userBId}, 'Session Mode Test User B', 'session-mode-test-b@example.test', 'ACTIVE')`;

    await admin`INSERT INTO workspaces
      (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status) VALUES
      (${workspaceAId}, ${userAId}, 'Session Mode Test Workspace A', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE'),
      (${workspaceBId}, ${userBId}, 'Session Mode Test Workspace B', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;

    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES
      (${membershipAId}, ${workspaceAId}, ${userAId}, 'OWNER', 'ACTIVE', now()),
      (${membershipBId}, ${workspaceBId}, ${userBId}, 'OWNER', 'ACTIVE', now())`;

    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES
      (${groupAId}, ${workspaceAId}, 'Session Mode Test Group A', 'ACTIVE'),
      (${groupBId}, ${workspaceBId}, 'Session Mode Test Group B', 'ACTIVE'),
      (${groupCId}, ${workspaceAId}, 'Session Mode Test Group C', 'ACTIVE')`;

    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES
      (${monthAId}, ${workspaceAId}, 2026, 8, 'CURRENT', ${userAId}),
      (${monthBId}, ${workspaceBId}, 2026, 8, 'CURRENT', ${userBId})`;

    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES
        (${groupMonthAId}, ${workspaceAId}, ${groupAId}, ${monthAId}, 60000, 'PER_GROUP', 'FULL'),
        (${groupMonthBId}, ${workspaceBId}, ${groupBId}, ${monthBId}, 60000, 'PER_GROUP', 'FULL'),
        (${groupMonthCId}, ${workspaceAId}, ${groupCId}, ${monthAId}, 60000, 'PER_GROUP', 'FULL')`;

    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status)
      VALUES
        (${studentAId}, ${workspaceAId}, 'AP-SESSA1', 'Session Student A', 'session student a', 'ACTIVE'),
        (${studentCId}, ${workspaceAId}, 'AP-SESSC1', 'Session Student C', 'session student c', 'ACTIVE')`;

    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method)
      VALUES
        (${enrollmentAId}, ${workspaceAId}, ${studentAId}, ${groupMonthAId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH'),
        (${enrollmentCId}, ${workspaceAId}, ${studentCId}, ${groupMonthCId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;

    await admin`INSERT INTO sessions (id, workspace_id, group_month_id, scheduled_at, duration_minutes, status, origin, created_by)
      VALUES
        (${sessionAId}, ${workspaceAId}, ${groupMonthAId}, '2026-08-10T08:00:00Z', 60, 'IN_PROGRESS', 'GENERATED', ${userAId}),
        (${sessionBId}, ${workspaceBId}, ${groupMonthBId}, '2026-08-10T08:00:00Z', 60, 'IN_PROGRESS', 'GENERATED', ${userBId}),
        (${sessionCId}, ${workspaceAId}, ${groupMonthCId}, '2026-08-10T08:00:00Z', 60, 'IN_PROGRESS', 'GENERATED', ${userAId})`;
  });

  afterAll(async () => {
    try {
      await admin`DELETE FROM session_records WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM session_exams WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM sessions WHERE id IN (${sessionAId}, ${sessionBId}, ${sessionCId})`;
      await admin`DELETE FROM enrollments WHERE id IN (${enrollmentAId}, ${enrollmentCId})`;
      await admin`DELETE FROM students WHERE id IN (${studentAId}, ${studentCId})`;
      await admin`DELETE FROM group_months WHERE workspace_id IN (${workspaceAId}, ${workspaceBId})`;
      await admin`DELETE FROM permission_group_scopes WHERE group_id IN (${groupAId}, ${groupBId}, ${groupCId})`;
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

  it("1. the composite FK rejects a session_records row whose session_id and enrollment_id belong to DIFFERENT GroupMonths (same workspace)", async () => {
    // session_id -> groupMonthA; enrollment_id -> groupMonthC; group_month_id claimed = A.
    await expect(
      withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
        db.execute(
          sql`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status)
              VALUES (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${sessionAId}, ${enrollmentCId}, 'PRESENT')`,
        ),
      ),
    ).rejects.toThrow(/violates foreign key constraint|session_records_enrollment_group_month_fk/i);
  });

  it("2. the composite FK accepts a session_records row whose session_id and enrollment_id share the SAME GroupMonth", async () => {
    const id = randomUUID();
    await withRuntimeContext({ userId: userAId, workspaceId: workspaceAId }, (db) =>
      db.execute(
        sql`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status)
            VALUES (${id}, ${workspaceAId}, ${groupMonthAId}, ${sessionAId}, ${enrollmentAId}, 'PRESENT')`,
      ),
    );
    const rows = await admin`SELECT id FROM session_records WHERE id = ${id}`;
    expect(rows).toHaveLength(1);
    await admin`DELETE FROM session_records WHERE id = ${id}`;
  });

  it("3. RLS blocks cross-workspace SELECT on session_records for app_runtime", async () => {
    const id = randomUUID();
    await admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status)
      VALUES (${id}, ${workspaceAId}, ${groupMonthAId}, ${sessionAId}, ${enrollmentAId}, 'PRESENT')`;

    const foreignRows = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM session_records WHERE id = ${id}`),
    );
    expect(foreignRows).toHaveLength(0);

    const ownRows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM session_records WHERE id = ${id}`),
    );
    expect(ownRows).toHaveLength(1);

    await admin`DELETE FROM session_records WHERE id = ${id}`;
  });

  it("4. RLS blocks cross-workspace SELECT on session_exams for app_runtime", async () => {
    const id = randomUUID();
    await admin`INSERT INTO session_exams (id, workspace_id, session_id, max_score) VALUES (${id}, ${workspaceAId}, ${sessionAId}, 20)`;

    const foreignRows = await withRuntimeContext({ workspaceId: workspaceBId }, (db) =>
      db.execute(sql`SELECT * FROM session_exams WHERE id = ${id}`),
    );
    expect(foreignRows).toHaveLength(0);

    const ownRows = await withRuntimeContext({ workspaceId: workspaceAId }, (db) =>
      db.execute(sql`SELECT * FROM session_exams WHERE id = ${id}`),
    );
    expect(ownRows).toHaveLength(1);

    await admin`DELETE FROM session_exams WHERE id = ${id}`;
  });

  it("5. app_runtime has no DELETE grant on session_records/session_exams", async () => {
    const id = randomUUID();
    await admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, attendance_status)
      VALUES (${id}, ${workspaceAId}, ${groupMonthAId}, ${sessionAId}, ${enrollmentAId}, 'PRESENT')`;

    await expect(
      withRuntimeContext({ workspaceId: workspaceAId }, (db) => db.execute(sql`DELETE FROM session_records WHERE id = ${id}`)),
    ).rejects.toThrow(/permission denied/i);

    await admin`DELETE FROM session_records WHERE id = ${id}`;
  });

  it("6. exam max_score>0 and low_score_threshold<=max_score are enforced at the DB level", async () => {
    await expect(
      admin`INSERT INTO session_exams (id, workspace_id, session_id, max_score) VALUES (${randomUUID()}, ${workspaceAId}, ${sessionCId}, 0)`,
    ).rejects.toThrow(/violates check constraint/i);

    await expect(
      admin`INSERT INTO session_exams (id, workspace_id, session_id, max_score, low_score_threshold)
        VALUES (${randomUUID()}, ${workspaceAId}, ${sessionCId}, 10, 15)`,
    ).rejects.toThrow(/violates check constraint/i);
  });

  it("7. ABSENT_FROM_EXAM with a non-null exam_score is rejected at the DB level (never a numeric zero stand-in)", async () => {
    await expect(
      admin`INSERT INTO session_records (id, workspace_id, group_month_id, session_id, enrollment_id, exam_status, exam_score)
        VALUES (${randomUUID()}, ${workspaceAId}, ${groupMonthAId}, ${sessionAId}, ${enrollmentAId}, 'ABSENT_FROM_EXAM', 0)`,
    ).rejects.toThrow(/violates check constraint/i);
  });
});
