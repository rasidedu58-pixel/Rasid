/**
 * Regression coverage for the Monthly Teacher Report on EMPTY data (added
 * after a transient staging 500 was reported against the QA month). The
 * report must ALWAYS return a valid zero/empty result — never throw — when a
 * month legitimately has no sessions / obligations / attention / follow-ups,
 * no group_months at all, or is queried by a caller who can see no groups; a
 * nonexistent/foreign month must resolve to `undefined` (→ 404), not a crash.
 *
 * These run against real Postgres (the empty-aggregate behavior is a SQL
 * property — coalesce(json_agg,'[]'), count(*)::int, a reduce from 0 over
 * NOT-NULL bigint columns — that an in-memory fake cannot verify). Gated on
 * `MIGRATION_DATABASE_URL` (admin) + a prior build; the function takes its
 * `db` handle as an argument, so it runs on a drizzle instance over the admin
 * connection and needs no distinct app_runtime URL (RLS is not what's under
 * test here — emptiness handling is).
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMonthlyTeacherReport } from "@academic-precision/database";

const MIGRATION_DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
const distEntryPoint = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const hasLiveCreds = !!MIGRATION_DATABASE_URL && existsSync(distEntryPoint);

if (!hasLiveCreds) {
  // eslint-disable-next-line no-console
  console.warn("[monthly-report-empty.integration.test] Skipping: requires MIGRATION_DATABASE_URL (admin) + a prior build.");
}

describe.skipIf(!hasLiveCreds)("Monthly Teacher Report — empty-data safety (live Postgres)", () => {
  let admin: Sql;
  let db: ReturnType<typeof drizzle>;

  const workspaceId = randomUUID();
  const userId = randomUUID();
  const groupId = randomUUID();
  const currentMonthId = randomUUID(); // has a group_month + enrollment, but NO sessions/obligations/attention
  const barrenMonthId = randomUUID(); // exists, but has ZERO group_months
  const groupMonthId = randomUUID();
  const studentId = randomUUID();
  const enrollmentId = randomUUID();

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    admin = postgres(MIGRATION_DATABASE_URL!, { max: 2 });
    db = drizzle(admin);
    await admin`INSERT INTO users (id, full_name, email_display, status) VALUES (${userId}, 'Empty Report Owner', 'empty-report-owner@example.test', 'ACTIVE')`;
    await admin`INSERT INTO workspaces (id, owner_user_id, name, workspace_type, locale, timezone, due_date_policy, status)
      VALUES (${workspaceId}, ${userId}, 'Empty Report Workspace', 'TEACHER', 'ar-EG', 'Africa/Cairo', 'PER_GROUP', 'ACTIVE')`;
    await admin`INSERT INTO memberships (id, workspace_id, user_id, role_label, status, joined_at) VALUES (${randomUUID()}, ${workspaceId}, ${userId}, 'OWNER', 'ACTIVE', now())`;
    await admin`INSERT INTO groups (id, workspace_id, name, status) VALUES (${groupId}, ${workspaceId}, 'Empty Report Group', 'ACTIVE')`;
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${currentMonthId}, ${workspaceId}, 2026, 8, 'CURRENT', ${userId})`;
    await admin`INSERT INTO operating_months (id, workspace_id, year, month, status, created_by) VALUES (${barrenMonthId}, ${workspaceId}, 2026, 9, 'DRAFT', ${userId})`;
    await admin`INSERT INTO group_months (id, workspace_id, group_id, operating_month_id, base_fee_minor, due_policy, join_fee_policy)
      VALUES (${groupMonthId}, ${workspaceId}, ${groupId}, ${currentMonthId}, 60000, 'PER_GROUP', 'FULL')`;
    await admin`INSERT INTO students (id, workspace_id, student_code, name, search_name_normalized, status) VALUES (${studentId}, ${workspaceId}, 'AP-EMPT1', 'Empty Student', 'empty student', 'ACTIVE')`;
    await admin`INSERT INTO enrollments (id, workspace_id, student_id, group_month_id, join_date, status, fee_method) VALUES (${enrollmentId}, ${workspaceId}, ${studentId}, ${groupMonthId}, '2026-08-01', 'ACTIVE', 'FULL_MONTH')`;
    // Deliberately NO sessions, obligations, payments, attention cases, or follow-ups.
  }, 60_000);

  afterAll(async () => {
    try {
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

  it("a month with a group + enrollment but ZERO sessions/obligations/attention/followups returns clean zeros (never throws)", async () => {
    const r = await getMonthlyTeacherReport(db, workspaceId, currentMonthId, "ALL");
    expect(r).toBeDefined();
    expect(r!.month.id).toBe(currentMonthId);
    expect(r!.groups).toHaveLength(1);
    expect(r!.groups[0]!.studentsCount).toBe(1);
    expect(r!.groups[0]!.sessionsCount).toBe(0);
    expect(r!.totals.studentsCount).toBe(1);
    expect(r!.totals.sessionsCount).toBe(0);
    expect(r!.totals.collection).toEqual({ totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0 });
    expect(r!.totals.overdueCount).toBe(0);
    expect(r!.totals.openAttentionCount).toBe(0);
    expect(r!.totals.openFollowupsCount).toBe(0);
  });

  it("a month with ZERO group_months returns the empty-totals shape (groups: [], all zeros)", async () => {
    const r = await getMonthlyTeacherReport(db, workspaceId, barrenMonthId, "ALL");
    expect(r).toBeDefined();
    expect(r!.month.id).toBe(barrenMonthId);
    expect(r!.groups).toEqual([]);
    expect(r!.totals.studentsCount).toBe(0);
    expect(r!.totals.collection.totalDueMinor).toBe(0);
  });

  it("a nonexistent / foreign month resolves to undefined (→ 404), not a crash", async () => {
    const r = await getMonthlyTeacherReport(db, workspaceId, randomUUID(), "ALL");
    expect(r).toBeUndefined();
  });

  it("a scoped caller who can see no groups gets a clean empty report, not an error", async () => {
    const r = await getMonthlyTeacherReport(db, workspaceId, currentMonthId, []);
    expect(r).toBeDefined();
    expect(r!.groups).toEqual([]);
    expect(r!.totals.studentsCount).toBe(0);
  });
});
