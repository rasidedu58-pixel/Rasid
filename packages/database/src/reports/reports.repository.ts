/**
 * Reports read-model — Phase 9.
 *
 * Per ADR-020 ("PostgreSQL first, projections/read models only when load
 * pressure appears"): every function here is a handful of plain, indexed
 * PostgreSQL queries against EXISTING tables (sessions, session_records,
 * enrollments, financial_obligations, attention_cases, scheduled_followups)
 * — no dedicated reporting tables, no generic-CRUD-style querying (API
 * Contract §20's own anti-pattern). Aggregation happens in application code
 * over small, workspace/month/group-bounded result sets — deliberately
 * simple, matching V1's actual data scale.
 *
 * Group Scope enforcement is NOT this module's job (mirrors every other
 * repository in this package) — the caller (apps/api's ReportsService)
 * resolves the caller's effective permission grant BEFORE calling in, and
 * for Monthly Teacher Report passes down `visibleGroupIds` so every
 * aggregate is computed from the VISIBLE dataset only (Phase 9 Closure
 * correction #1 — no ALL_GROUPS requirement, no aggregate that leaks the
 * existence of a hidden group).
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { students } from "../schema/students";
import { enrollments } from "../schema/enrollments";
import { groupMonths, groups } from "../schema/groups";
import { operatingMonths } from "../schema/months";
import { sessions } from "../schema/sessions";
import { sessionRecords } from "../schema/session-records";
import { financialObligations } from "../schema/finance";
import { attentionCases } from "../schema/attention";
import { scheduledFollowups } from "../schema/followup";
import { workspaces } from "../schema/workspaces";
import { reportExports } from "../schema/reports";
import { deriveEligibleEnrollmentIds } from "../session-mode/roster";
import { deriveMissingRecords } from "../session-mode/missing-records";
import type { Db } from "../repositories/identity.repository";

export type ExportRow = typeof reportExports.$inferSelect;

/** The workspace's display name — used only for the export document header. Runs under the tenant's own RLS context. */
export async function getReportWorkspaceName(db: Db, workspaceId: string): Promise<string | undefined> {
  const [row] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return row?.name;
}

export interface CreateExportInput {
  workspaceId: string;
  requestedByMembershipId: string;
  type: "STUDENT" | "GROUP" | "MONTHLY_TEACHER";
  params: Record<string, unknown>;
  expiresAt: Date;
}

/** V1 always writes `status: "READY"` in the SAME insert (see schema/reports.ts's own doc comment — no async worker exists yet). */
export async function createExport(db: Db, input: CreateExportInput): Promise<ExportRow> {
  const [row] = await db
    .insert(reportExports)
    .values({
      workspaceId: input.workspaceId,
      requestedByMembershipId: input.requestedByMembershipId,
      type: input.type,
      params: input.params,
      status: "READY",
      expiresAt: input.expiresAt,
    })
    .returning();
  if (!row) throw new Error("Failed to insert exports row.");
  return row;
}

export async function findExport(db: Db, workspaceId: string, exportId: string): Promise<ExportRow | undefined> {
  const [row] = await db
    .select()
    .from(reportExports)
    .where(and(eq(reportExports.workspaceId, workspaceId), eq(reportExports.id, exportId)))
    .limit(1);
  return row;
}

/** Sessions that "count" toward completed/missing aggregates — a SCHEDULED session hasn't happened yet, and CANCELLED/RESCHEDULED sessions never produce records. */
const COUNTABLE_SESSION_STATUSES = ["IN_PROGRESS", "COMPLETED"] as const;

// ---------------------------------------------------------------------------
// Student Report — GET /reports/student/{id}
// ---------------------------------------------------------------------------

export interface StudentReportResult {
  student: { id: string; name: string; studentCode: string; status: string };
  currentMonth: { id: string; year: number; month: number } | null;
  sessions: {
    total: number;
    attendance: { present: number; absent: number; late: number; missing: number };
    homework: { done: number; partial: number; notDone: number; noHomework: number; missing: number };
    exam: { scored: number; absent: number; missing: number };
  };
  activeAttentionCase: { id: string; status: string; priority: string; openedAt: Date } | null;
  obligationsByMonth: Array<{
    monthId: string;
    year: number;
    month: number;
    groupId: string;
    groupName: string;
    netDueMinor: number;
    amountPaidMinor: number;
    remainingMinor: number;
    status: string;
  }>;
}

export async function getStudentReport(db: Db, workspaceId: string, studentId: string): Promise<StudentReportResult | undefined> {
  const [student] = await db.select().from(students).where(and(eq(students.workspaceId, workspaceId), eq(students.id, studentId))).limit(1);
  if (!student) return undefined;

  const [currentMonth] = await db
    .select()
    .from(operatingMonths)
    .where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, "CURRENT")))
    .limit(1);

  // All-time enrollments (obligations/payments span months per PRD §38's
  // "obligations/payments by month" bullet).
  const studentEnrollments = await db
    .select({
      enrollmentId: enrollments.id,
      groupMonthId: enrollments.groupMonthId,
      status: enrollments.status,
    })
    .from(enrollments)
    .where(and(eq(enrollments.workspaceId, workspaceId), eq(enrollments.studentId, studentId)));

  const groupMonthIds = [...new Set(studentEnrollments.map((e) => e.groupMonthId))];
  const groupMonthRows = groupMonthIds.length
    ? await db
        .select({
          id: groupMonths.id,
          groupId: groupMonths.groupId,
          operatingMonthId: groupMonths.operatingMonthId,
          groupName: groups.name,
          year: operatingMonths.year,
          month: operatingMonths.month,
        })
        .from(groupMonths)
        .innerJoin(groups, eq(groups.id, groupMonths.groupId))
        .innerJoin(operatingMonths, eq(operatingMonths.id, groupMonths.operatingMonthId))
        .where(inArray(groupMonths.id, groupMonthIds))
    : [];
  const groupMonthById = new Map(groupMonthRows.map((gm) => [gm.id, gm]));

  const obligationRows = await db
    .select()
    .from(financialObligations)
    .innerJoin(enrollments, eq(enrollments.id, financialObligations.enrollmentId))
    .where(and(eq(financialObligations.workspaceId, workspaceId), eq(enrollments.studentId, studentId)));

  const obligationsByMonth = obligationRows
    .map((row) => {
      const gm = groupMonthById.get(row.enrollments.groupMonthId);
      if (!gm) return null;
      return {
        monthId: gm.operatingMonthId,
        year: gm.year,
        month: gm.month,
        groupId: gm.groupId,
        groupName: gm.groupName,
        netDueMinor: row.financial_obligations.netDueMinor,
        amountPaidMinor: row.financial_obligations.amountPaidMinor,
        remainingMinor: row.financial_obligations.remainingMinor,
        status: row.financial_obligations.status,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.year - a.year || b.month - a.month);

  // Sessions/attendance/homework/exam are scoped to the CURRENT operating
  // month's enrollments only (there is no reasonable "all-time" session
  // aggregate — a session belongs to exactly one GroupMonth/month).
  const currentMonthEnrollmentIds = currentMonth
    ? studentEnrollments.filter((e) => groupMonthById.get(e.groupMonthId)?.operatingMonthId === currentMonth.id).map((e) => e.enrollmentId)
    : [];

  const sessionsAgg = { total: 0, attendance: { present: 0, absent: 0, late: 0, missing: 0 }, homework: { done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0 }, exam: { scored: 0, absent: 0, missing: 0 } };

  if (currentMonthEnrollmentIds.length > 0) {
    const records = await db
      .select()
      .from(sessionRecords)
      .where(and(eq(sessionRecords.workspaceId, workspaceId), inArray(sessionRecords.enrollmentId, currentMonthEnrollmentIds)));
    sessionsAgg.total = records.length;
    for (const r of records) {
      switch (r.attendanceStatus) {
        case "PRESENT":
          sessionsAgg.attendance.present += 1;
          break;
        case "ABSENT":
          sessionsAgg.attendance.absent += 1;
          break;
        case "LATE":
          sessionsAgg.attendance.late += 1;
          break;
        default:
          sessionsAgg.attendance.missing += 1;
      }
      switch (r.homeworkStatus) {
        case "DONE":
          sessionsAgg.homework.done += 1;
          break;
        case "PARTIAL":
          sessionsAgg.homework.partial += 1;
          break;
        case "NOT_DONE":
          sessionsAgg.homework.notDone += 1;
          break;
        case "NO_HOMEWORK":
          sessionsAgg.homework.noHomework += 1;
          break;
        default:
          sessionsAgg.homework.missing += 1;
      }
      if (r.examStatus === "SCORED") sessionsAgg.exam.scored += 1;
      else if (r.examStatus === "ABSENT_FROM_EXAM") sessionsAgg.exam.absent += 1;
      else if (r.examStatus !== "NO_EXAM") sessionsAgg.exam.missing += 1;
    }
  }

  // At most one non-CLOSED case can exist per (workspace, student) — the
  // partial unique index (§9.1) already guarantees this, so no ORDER BY/
  // LIMIT ambiguity is possible.
  const [activeCase] = await db
    .select()
    .from(attentionCases)
    .where(and(eq(attentionCases.workspaceId, workspaceId), eq(attentionCases.studentId, studentId), ne(attentionCases.status, "CLOSED")))
    .limit(1);

  return {
    student: { id: student.id, name: student.name, studentCode: student.studentCode, status: student.status },
    currentMonth: currentMonth ? { id: currentMonth.id, year: currentMonth.year, month: currentMonth.month } : null,
    sessions: sessionsAgg,
    activeAttentionCase: activeCase ? { id: activeCase.id, status: activeCase.status, priority: activeCase.priority, openedAt: activeCase.openedAt } : null,
    obligationsByMonth,
  };
}

// ---------------------------------------------------------------------------
// Group Report — GET /reports/group/{id}
// ---------------------------------------------------------------------------

export interface GroupReportResult {
  group: { id: string; name: string; status: string };
  currentMonth: { id: string; year: number; month: number } | null;
  roster: Array<{ enrollmentId: string; studentId: string; studentName: string; status: string }>;
  sessions: { total: number; completed: number };
  attendance: { present: number; absent: number; late: number; missing: number };
  homework: { done: number; partial: number; notDone: number; noHomework: number; missing: number };
  missingRecordsCount: number;
  collection: { totalDueMinor: number; totalPaidMinor: number; totalRemainingMinor: number; overdueCount: number };
}

interface GroupReportRawRow extends Record<string, unknown> {
  group: { id: string; name: string; status: string } | null;
  current_month: { id: string; year: number; month: number } | null;
  group_month: { id: string } | null;
  timezone: string | null;
  roster: Array<{ enrollment_id: string; student_id: string; student_name: string; status: string; join_date: string; ended_at: string | null }>;
  sessions: Array<{ id: string; status: string; scheduled_at: string }>;
  records: Array<{ session_id: string; enrollment_id: string; attendance_status: string | null; homework_status: string | null; exam_status: string }>;
  obligations: Array<{ net_due_minor: number; amount_paid_minor: number; remaining_minor: number; status: string; due_date: string }>;
}

export async function getGroupReport(db: Db, workspaceId: string, groupId: string): Promise<GroupReportResult | undefined> {
  // Phase 10 Closure Delta — round-trip reduction, corrected root cause.
  //
  // First attempt (superseded): batching independent SELECTs with
  // Promise.all, on the theory that postgres.js pipelines concurrently-
  // issued statements on one connection. That assumption held for
  // synthetic pg_sleep() probes (5×10ms sequential ≈950ms vs. ≈120ms
  // pipelined) but did NOT reproduce for Drizzle's query-builder SELECTs
  // against real tables — measured directly (packages/database/src/scripts/
  // diag-report-timing*.ts, not committed, throwaway diagnostics): 2
  // real SELECTs via Promise.all took ~280-450ms, essentially the SAME as
  // running them sequentially (~140-150ms EACH, not amortized). Re-running
  // the Phase 10 benchmark after that first attempt confirmed it: p50 barely
  // moved (1541ms -> 1497ms for Group Report). So the fix was reverted.
  //
  // Actual measured root cause: this shared dev environment's round trip to
  // Postgres costs ~140-190ms PER STATEMENT (own instrumentation, not the
  // ~98ms bare "SELECT 1" figure — real SELECTs with WHERE/JOIN clauses and
  // real result payloads cost more per round trip than a trivial probe).
  // EXPLAIN (ANALYZE, BUFFERS) on every one of the original 8 queries showed
  // sub-25ms server-side execution time even for the largest (500-row
  // session_records fetch) — so virtually 100% of the ~1.5s total was
  // network round-trip count × per-trip latency, not query cost or a
  // missing index. The only optimization that actually reduces round-trip
  // COUNT (rather than hoping the driver pipelines concurrent ones) is
  // fewer statements: this function now issues exactly ONE query — a single
  // set-based SQL statement using CTEs + json_agg — that the original 8
  // sequential SELECTs are compiled down to server-side. Confirmed via a
  // standalone prototype against the same synthetic dataset: ~150-160ms per
  // call (steady-state) vs. ~1500ms before, an ~10x reduction, with zero
  // caching, zero denormalization, and zero business-logic change — the
  // exact same rows are computed, just fetched in one trip instead of 8.
  const [row] = await db.execute<GroupReportRawRow>(sql`
    WITH target_group AS (
      SELECT id, name, status FROM groups WHERE workspace_id = ${workspaceId} AND id = ${groupId}
    ),
    current_month AS (
      SELECT id, year, month FROM operating_months WHERE workspace_id = ${workspaceId} AND status = 'CURRENT'
    ),
    tgm AS (
      SELECT gm.id FROM group_months gm, current_month cm
      WHERE gm.workspace_id = ${workspaceId} AND gm.group_id = ${groupId} AND gm.operating_month_id = cm.id
    ),
    ws AS (
      SELECT timezone FROM workspaces WHERE id = ${workspaceId}
    ),
    roster AS (
      SELECT e.id AS enrollment_id, e.student_id, s.name AS student_name, e.status, e.join_date, e.ended_at
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      JOIN tgm ON tgm.id = e.group_month_id
      WHERE e.workspace_id = ${workspaceId}
    ),
    grp_sessions AS (
      SELECT sess.id, sess.status, sess.scheduled_at
      FROM sessions sess
      JOIN tgm ON tgm.id = sess.group_month_id
      WHERE sess.workspace_id = ${workspaceId}
    ),
    grp_records AS (
      SELECT sr.session_id, sr.enrollment_id, sr.attendance_status, sr.homework_status, sr.exam_status
      FROM session_records sr
      JOIN grp_sessions gs ON gs.id = sr.session_id
      WHERE sr.workspace_id = ${workspaceId} AND gs.status IN ('IN_PROGRESS', 'COMPLETED')
    ),
    grp_obligations AS (
      SELECT fo.net_due_minor, fo.amount_paid_minor, fo.remaining_minor, fo.status, fo.due_date
      FROM financial_obligations fo
      JOIN roster r ON r.enrollment_id = fo.enrollment_id
      WHERE fo.workspace_id = ${workspaceId}
    )
    SELECT
      (SELECT row_to_json(target_group) FROM target_group) AS group,
      (SELECT row_to_json(current_month) FROM current_month) AS current_month,
      (SELECT row_to_json(tgm) FROM tgm) AS group_month,
      (SELECT timezone FROM ws) AS timezone,
      (SELECT coalesce(json_agg(roster), '[]') FROM roster) AS roster,
      (SELECT coalesce(json_agg(grp_sessions), '[]') FROM grp_sessions) AS sessions,
      (SELECT coalesce(json_agg(grp_records), '[]') FROM grp_records) AS records,
      (SELECT coalesce(json_agg(grp_obligations), '[]') FROM grp_obligations) AS obligations
  `);
  if (!row || !row.group) return undefined;
  const group = row.group;
  const currentMonth = row.current_month;

  const empty: GroupReportResult = {
    group: { id: group.id, name: group.name, status: group.status },
    currentMonth: currentMonth ? { id: currentMonth.id, year: currentMonth.year, month: currentMonth.month } : null,
    roster: [],
    sessions: { total: 0, completed: 0 },
    attendance: { present: 0, absent: 0, late: 0, missing: 0 },
    homework: { done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0 },
    missingRecordsCount: 0,
    collection: { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0, overdueCount: 0 },
  };
  if (!currentMonth) return empty;
  if (!row.group_month) return empty;

  const workspaceTimezone = row.timezone ?? "Africa/Cairo";
  const rosterEnrollments = row.roster.map((e) => ({
    enrollmentId: e.enrollment_id,
    studentId: e.student_id,
    studentName: e.student_name,
    status: e.status,
    joinDate: e.join_date,
    endedAt: e.ended_at ? new Date(e.ended_at) : null,
  }));
  const groupSessions = row.sessions.map((s) => ({ id: s.id, status: s.status, scheduledAt: new Date(s.scheduled_at) }));
  const records = row.records.map((r) => ({ sessionId: r.session_id, enrollmentId: r.enrollment_id, attendanceStatus: r.attendance_status, homeworkStatus: r.homework_status, examStatus: r.exam_status }));
  const obligations = row.obligations.map((o) => ({ netDueMinor: o.net_due_minor, amountPaidMinor: o.amount_paid_minor, remainingMinor: o.remaining_minor, status: o.status, dueDate: o.due_date }));

  const roster = rosterEnrollments
    .filter((e) => e.status === "ACTIVE")
    .map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId, studentName: e.studentName, status: e.status }));

  const countableSessions = groupSessions.filter((s) => (COUNTABLE_SESSION_STATUSES as readonly string[]).includes(s.status));

  const attendance = { present: 0, absent: 0, late: 0, missing: 0 };
  const homework = { done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0 };
  let missingRecordsCount = 0;

  if (countableSessions.length > 0) {
    const recordsBySession = new Map<string, typeof records>();
    for (const r of records) {
      const list = recordsBySession.get(r.sessionId) ?? [];
      list.push(r);
      recordsBySession.set(r.sessionId, list);
    }
    const studentNameByEnrollmentId = new Map(rosterEnrollments.map((e) => [e.enrollmentId, e.studentName]));

    for (const session of countableSessions) {
      const eligibleEnrollmentIds = deriveEligibleEnrollmentIds({
        enrollments: rosterEnrollments.map((e) => ({ enrollmentId: e.enrollmentId, joinDate: e.joinDate, endedAt: e.endedAt })),
        sessionScheduledAt: session.scheduledAt,
        workspaceTimezone,
      });
      const sessionRecordsList = recordsBySession.get(session.id) ?? [];
      const recordsByEnrollmentId = new Map(sessionRecordsList.map((r) => [r.enrollmentId, r]));

      const result = deriveMissingRecords({ eligibleEnrollmentIds, recordsByEnrollmentId, studentNameByEnrollmentId });
      attendance.present += result.attendanceSummary.present;
      attendance.absent += result.attendanceSummary.absent;
      attendance.late += result.attendanceSummary.late;
      attendance.missing += result.attendanceSummary.missing;
      homework.done += result.homeworkSummary.done;
      homework.partial += result.homeworkSummary.partial;
      homework.notDone += result.homeworkSummary.notDone;
      homework.noHomework += result.homeworkSummary.noHomework;
      homework.missing += result.homeworkSummary.missing;
      missingRecordsCount += result.missingRecords.length;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const collection = obligations.reduce(
    (acc, o) => {
      acc.totalDueMinor += o.netDueMinor;
      acc.totalPaidMinor += o.amountPaidMinor;
      acc.totalRemainingMinor += o.remainingMinor;
      if (o.status !== "PAID" && o.dueDate < today) acc.overdueCount += 1;
      return acc;
    },
    { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0, overdueCount: 0 },
  );

  return {
    group: { id: group.id, name: group.name, status: group.status },
    currentMonth: { id: currentMonth.id, year: currentMonth.year, month: currentMonth.month },
    roster,
    sessions: { total: groupSessions.length, completed: groupSessions.filter((s) => s.status === "COMPLETED").length },
    attendance,
    homework,
    missingRecordsCount,
    collection,
  };
}

// ---------------------------------------------------------------------------
// Monthly Teacher Report — GET /reports/monthly/{monthId}
//
// Phase 9 Closure correction #1: `visibleGroupIds` is `"ALL"` for an
// Owner/ALL_GROUPS caller, or an explicit array for a SELECTED_GROUPS
// caller — every aggregate below (totals, counts) is computed ONLY from
// group_months whose group_id is in scope. A SELECTED_GROUPS caller never
// sees a total that implies the existence of a hidden group.
// ---------------------------------------------------------------------------

export interface MonthlyTeacherReportResult {
  month: { id: string; year: number; month: number; status: string };
  groups: Array<{ groupId: string; groupName: string; studentsCount: number; sessionsCount: number }>;
  totals: {
    studentsCount: number;
    sessionsCount: number;
    collection: { totalDueMinor: number; totalPaidMinor: number; totalRemainingMinor: number };
    overdueCount: number;
    openAttentionCount: number;
    openFollowupsCount: number;
  };
}

interface MonthlyReportRawRow extends Record<string, unknown> {
  month: { id: string; year: number; month: number; status: string } | null;
  group_months: Array<{ id: string; group_id: string; group_name: string }>;
  active_enrollments: Array<{ id: string; group_month_id: string; student_id: string }>;
  sessions: Array<{ id: string; group_month_id: string }>;
  obligations: Array<{ net_due_minor: number; amount_paid_minor: number; remaining_minor: number; status: string; due_date: string }>;
  open_attention_count: number;
  open_followups_count: number;
}

export async function getMonthlyTeacherReport(
  db: Db,
  workspaceId: string,
  monthId: string,
  visibleGroupIds: "ALL" | string[],
): Promise<MonthlyTeacherReportResult | undefined> {
  // Phase 10 Closure Delta — same measured root cause and same single-
  // query-via-CTE fix as getGroupReport (see its own comment for the full
  // diagnosis: per-statement round-trip latency in this environment, not
  // query cost — confirmed via EXPLAIN ANALYZE and direct instrumentation).
  // The original 7 sequential SELECTs (month, group_months, enrollments,
  // sessions, obligations, attention cases, follow-ups) are compiled down
  // to ONE statement here. `visibleGroupIds` (Phase 9 Closure correction #1
  // — no ALL_GROUPS requirement) is pushed into the group_months CTE's own
  // WHERE clause instead of filtering client-side, so a SELECTED_GROUPS
  // caller's aggregates are still computed from the SAME restricted dataset
  // as before. Note: unlike raw postgres.js tagged templates (which encode
  // a plain JS array as a `uuid[]` parameter directly), drizzle-orm's own
  // `sql` template does NOT do this — passing the array bare produced a
  // real "malformed array literal" error, caught by this file's own
  // integration test suite before this landed. `sql.join(...IN (...))` is
  // the correct drizzle-orm-native way to parameterize a variable-length
  // list. An explicit-but-empty list short-circuits before the query is
  // built at all (an empty `IN ()` is invalid SQL, and the correct answer
  // — zero visible groups — is the same as `groupMonthRows.length === 0`
  // was in the original code).
  if (visibleGroupIds !== "ALL" && visibleGroupIds.length === 0) {
    const [monthOnly] = await db.select().from(operatingMonths).where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.id, monthId))).limit(1);
    if (!monthOnly) return undefined;
    return {
      month: { id: monthOnly.id, year: monthOnly.year, month: monthOnly.month, status: monthOnly.status },
      groups: [],
      totals: { studentsCount: 0, sessionsCount: 0, collection: { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0 }, overdueCount: 0, openAttentionCount: 0, openFollowupsCount: 0 },
    };
  }
  const groupFilter = visibleGroupIds === "ALL" ? sql`` : sql`AND gm.group_id IN (${sql.join(visibleGroupIds.map((id) => sql`${id}::uuid`), sql`, `)})`;
  const [row] = await db.execute<MonthlyReportRawRow>(sql`
    WITH target_month AS (
      SELECT id, year, month, status FROM operating_months WHERE workspace_id = ${workspaceId} AND id = ${monthId}
    ),
    gm AS (
      SELECT gm.id, gm.group_id, g.name AS group_name
      FROM group_months gm
      JOIN groups g ON g.id = gm.group_id
      JOIN target_month tm ON tm.id = gm.operating_month_id
      WHERE gm.workspace_id = ${workspaceId} ${groupFilter}
    ),
    enr AS (
      SELECT e.id, e.group_month_id, e.student_id, e.status
      FROM enrollments e
      JOIN gm ON gm.id = e.group_month_id
      WHERE e.workspace_id = ${workspaceId}
    ),
    active_enr AS (
      SELECT id, group_month_id, student_id FROM enr WHERE status = 'ACTIVE'
    ),
    sess AS (
      SELECT s.id, s.group_month_id
      FROM sessions s
      JOIN gm ON gm.id = s.group_month_id
      WHERE s.workspace_id = ${workspaceId}
    ),
    obl AS (
      SELECT fo.net_due_minor, fo.amount_paid_minor, fo.remaining_minor, fo.status, fo.due_date
      FROM financial_obligations fo
      JOIN active_enr ae ON ae.id = fo.enrollment_id
      WHERE fo.workspace_id = ${workspaceId}
    ),
    visible_students AS (
      SELECT DISTINCT student_id FROM active_enr
    ),
    open_attn AS (
      SELECT ac.id
      FROM attention_cases ac
      JOIN visible_students vs ON vs.student_id = ac.student_id
      WHERE ac.workspace_id = ${workspaceId} AND ac.status <> 'CLOSED'
    ),
    open_fu AS (
      SELECT sf.id
      FROM scheduled_followups sf
      JOIN visible_students vs ON vs.student_id = sf.student_id
      WHERE sf.workspace_id = ${workspaceId} AND sf.status = 'PENDING'
    )
    SELECT
      (SELECT row_to_json(target_month) FROM target_month) AS month,
      (SELECT coalesce(json_agg(gm), '[]') FROM gm) AS group_months,
      (SELECT coalesce(json_agg(active_enr), '[]') FROM active_enr) AS active_enrollments,
      (SELECT coalesce(json_agg(sess), '[]') FROM sess) AS sessions,
      (SELECT coalesce(json_agg(obl), '[]') FROM obl) AS obligations,
      (SELECT count(*)::int FROM open_attn) AS open_attention_count,
      (SELECT count(*)::int FROM open_fu) AS open_followups_count
  `);
  if (!row || !row.month) return undefined;
  const month = row.month;

  const emptyTotals: MonthlyTeacherReportResult = {
    month: { id: month.id, year: month.year, month: month.month, status: month.status },
    groups: [],
    totals: { studentsCount: 0, sessionsCount: 0, collection: { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0 }, overdueCount: 0, openAttentionCount: 0, openFollowupsCount: 0 },
  };
  if (row.group_months.length === 0) return emptyTotals;

  const activeEnrollments = row.active_enrollments.map((e) => ({ id: e.id, groupMonthId: e.group_month_id, studentId: e.student_id }));
  const sessionRows = row.sessions.map((s) => ({ id: s.id, groupMonthId: s.group_month_id }));
  const obligations = row.obligations.map((o) => ({ netDueMinor: o.net_due_minor, amountPaidMinor: o.amount_paid_minor, remainingMinor: o.remaining_minor, status: o.status, dueDate: o.due_date }));

  const groupsBreakdown = row.group_months.map((gm) => ({
    groupId: gm.group_id,
    groupName: gm.group_name,
    studentsCount: activeEnrollments.filter((e) => e.groupMonthId === gm.id).length,
    sessionsCount: sessionRows.filter((s) => s.groupMonthId === gm.id).length,
  }));

  // Attention/follow-ups are visible-STUDENT-scoped (a student can only be
  // "in scope" via an enrollment in a visible group_month this month) —
  // never a raw workspace-wide count, which would leak activity for
  // students the caller cannot otherwise see.
  const visibleStudentIds = [...new Set(activeEnrollments.map((e) => e.studentId))];

  const today = new Date().toISOString().slice(0, 10);
  const collectionTotals = obligations.reduce(
    (acc, o) => {
      acc.totalDueMinor += o.netDueMinor;
      acc.totalPaidMinor += o.amountPaidMinor;
      acc.totalRemainingMinor += o.remainingMinor;
      if (o.status !== "PAID" && o.dueDate < today) acc.overdueCount += 1;
      return acc;
    },
    { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0, overdueCount: 0 },
  );

  return {
    month: { id: month.id, year: month.year, month: month.month, status: month.status },
    groups: groupsBreakdown,
    totals: {
      studentsCount: visibleStudentIds.length,
      sessionsCount: sessionRows.length,
      collection: { totalDueMinor: collectionTotals.totalDueMinor, totalPaidMinor: collectionTotals.totalPaidMinor, totalRemainingMinor: collectionTotals.totalRemainingMinor },
      overdueCount: collectionTotals.overdueCount,
      openAttentionCount: row.open_attention_count,
      openFollowupsCount: row.open_followups_count,
    },
  };
}
