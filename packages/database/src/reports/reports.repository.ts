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
import { and, eq, inArray, ne } from "drizzle-orm";
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

export async function getGroupReport(db: Db, workspaceId: string, groupId: string): Promise<GroupReportResult | undefined> {
  const [group] = await db.select().from(groups).where(and(eq(groups.workspaceId, workspaceId), eq(groups.id, groupId))).limit(1);
  if (!group) return undefined;

  const [currentMonth] = await db
    .select()
    .from(operatingMonths)
    .where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, "CURRENT")))
    .limit(1);

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

  const [groupMonth] = await db
    .select()
    .from(groupMonths)
    .where(and(eq(groupMonths.workspaceId, workspaceId), eq(groupMonths.groupId, groupId), eq(groupMonths.operatingMonthId, currentMonth.id)))
    .limit(1);
  if (!groupMonth) return empty;

  const [workspace] = await db.select({ timezone: workspaces.timezone }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const workspaceTimezone = workspace?.timezone ?? "Africa/Cairo";

  const rosterEnrollments = await db
    .select({
      enrollmentId: enrollments.id,
      studentId: enrollments.studentId,
      studentName: students.name,
      status: enrollments.status,
      joinDate: enrollments.joinDate,
      endedAt: enrollments.endedAt,
    })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(and(eq(enrollments.workspaceId, workspaceId), eq(enrollments.groupMonthId, groupMonth.id)));

  const roster = rosterEnrollments
    .filter((e) => e.status === "ACTIVE")
    .map((e) => ({ enrollmentId: e.enrollmentId, studentId: e.studentId, studentName: e.studentName, status: e.status }));

  const groupSessions = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.workspaceId, workspaceId), eq(sessions.groupMonthId, groupMonth.id)));
  const countableSessions = groupSessions.filter((s) => (COUNTABLE_SESSION_STATUSES as readonly string[]).includes(s.status));

  const attendance = { present: 0, absent: 0, late: 0, missing: 0 };
  const homework = { done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0 };
  let missingRecordsCount = 0;

  if (countableSessions.length > 0) {
    const sessionIds = countableSessions.map((s) => s.id);
    const records = await db.select().from(sessionRecords).where(and(eq(sessionRecords.workspaceId, workspaceId), inArray(sessionRecords.sessionId, sessionIds)));
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

  const obligations = rosterEnrollments.length
    ? await db
        .select()
        .from(financialObligations)
        .where(and(eq(financialObligations.workspaceId, workspaceId), inArray(financialObligations.enrollmentId, rosterEnrollments.map((e) => e.enrollmentId))))
    : [];
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

export async function getMonthlyTeacherReport(
  db: Db,
  workspaceId: string,
  monthId: string,
  visibleGroupIds: "ALL" | string[],
): Promise<MonthlyTeacherReportResult | undefined> {
  const [month] = await db.select().from(operatingMonths).where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.id, monthId))).limit(1);
  if (!month) return undefined;

  let groupMonthRows = await db
    .select({ id: groupMonths.id, groupId: groupMonths.groupId, groupName: groups.name })
    .from(groupMonths)
    .innerJoin(groups, eq(groups.id, groupMonths.groupId))
    .where(and(eq(groupMonths.workspaceId, workspaceId), eq(groupMonths.operatingMonthId, monthId)));

  if (visibleGroupIds !== "ALL") {
    const visibleSet = new Set(visibleGroupIds);
    groupMonthRows = groupMonthRows.filter((gm) => visibleSet.has(gm.groupId));
  }

  const emptyTotals: MonthlyTeacherReportResult = {
    month: { id: month.id, year: month.year, month: month.month, status: month.status },
    groups: [],
    totals: { studentsCount: 0, sessionsCount: 0, collection: { totalDueMinor: 0, totalPaidMinor: 0, totalRemainingMinor: 0 }, overdueCount: 0, openAttentionCount: 0, openFollowupsCount: 0 },
  };
  if (groupMonthRows.length === 0) return emptyTotals;

  const groupMonthIds = groupMonthRows.map((gm) => gm.id);

  const enrollmentRows = await db
    .select({ id: enrollments.id, groupMonthId: enrollments.groupMonthId, studentId: enrollments.studentId, status: enrollments.status })
    .from(enrollments)
    .where(and(eq(enrollments.workspaceId, workspaceId), inArray(enrollments.groupMonthId, groupMonthIds)));
  const activeEnrollments = enrollmentRows.filter((e) => e.status === "ACTIVE");

  const sessionRows = await db
    .select({ id: sessions.id, groupMonthId: sessions.groupMonthId })
    .from(sessions)
    .where(and(eq(sessions.workspaceId, workspaceId), inArray(sessions.groupMonthId, groupMonthIds)));

  const groupsBreakdown = groupMonthRows.map((gm) => ({
    groupId: gm.groupId,
    groupName: gm.groupName,
    studentsCount: activeEnrollments.filter((e) => e.groupMonthId === gm.id).length,
    sessionsCount: sessionRows.filter((s) => s.groupMonthId === gm.id).length,
  }));

  const obligations = activeEnrollments.length
    ? await db
        .select()
        .from(financialObligations)
        .where(and(eq(financialObligations.workspaceId, workspaceId), inArray(financialObligations.enrollmentId, activeEnrollments.map((e) => e.id))))
    : [];
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

  // Attention/follow-ups are visible-STUDENT-scoped (a student can only be
  // "in scope" via an enrollment in a visible group_month this month) —
  // never a raw workspace-wide count, which would leak activity for
  // students the caller cannot otherwise see.
  const visibleStudentIds = [...new Set(activeEnrollments.map((e) => e.studentId))];

  const openAttentionCases = visibleStudentIds.length
    ? await db
        .select({ id: attentionCases.id })
        .from(attentionCases)
        .where(and(eq(attentionCases.workspaceId, workspaceId), inArray(attentionCases.studentId, visibleStudentIds), ne(attentionCases.status, "CLOSED")))
    : [];

  const openFollowups = visibleStudentIds.length
    ? await db
        .select({ id: scheduledFollowups.id })
        .from(scheduledFollowups)
        .where(and(eq(scheduledFollowups.workspaceId, workspaceId), inArray(scheduledFollowups.studentId, visibleStudentIds), eq(scheduledFollowups.status, "PENDING")))
    : [];

  return {
    month: { id: month.id, year: month.year, month: month.month, status: month.status },
    groups: groupsBreakdown,
    totals: {
      studentsCount: visibleStudentIds.length,
      sessionsCount: sessionRows.length,
      collection: { totalDueMinor: collectionTotals.totalDueMinor, totalPaidMinor: collectionTotals.totalPaidMinor, totalRemainingMinor: collectionTotals.totalRemainingMinor },
      overdueCount: collectionTotals.overdueCount,
      openAttentionCount: openAttentionCases.length,
      openFollowupsCount: openFollowups.length,
    },
  };
}
