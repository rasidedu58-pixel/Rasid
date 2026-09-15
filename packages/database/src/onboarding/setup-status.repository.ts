/**
 * Onboarding setup-status derivation — read-only aggregator over the real
 * workspace domain. Every step returns a plain boolean derived from an
 * `EXISTS`-equivalent `LIMIT 1` select on already-indexed columns; no
 * shadow completion table, no schema migration.
 *
 * Predicates (kept in one place so the API + tests can never drift from
 * the SQL truth):
 *
 *   Step 1 — operating month
 *     SELECT 1 FROM operating_months
 *      WHERE workspace_id = :ws AND status = 'CURRENT' LIMIT 1
 *
 *   Step 2 — group + valid schedule (scoped to CURRENT month)
 *     SELECT 1
 *       FROM schedule_rules sr
 *       JOIN group_months gm ON gm.id = sr.group_month_id
 *       JOIN operating_months om ON om.id = gm.operating_month_id
 *       JOIN groups g ON g.id = gm.group_id
 *      WHERE om.workspace_id = :ws
 *        AND om.status = 'CURRENT'
 *        AND g.status = 'ACTIVE'
 *      LIMIT 1
 *
 *   Step 3 — active enrollment in a group_month of the CURRENT month
 *     SELECT 1
 *       FROM enrollments e
 *       JOIN group_months gm ON gm.id = e.group_month_id
 *       JOIN operating_months om ON om.id = gm.operating_month_id
 *      WHERE e.workspace_id = :ws
 *        AND e.status = 'ACTIVE'
 *        AND om.status = 'CURRENT'
 *      LIMIT 1
 *
 *   Step 4 — auto-generated session bound to a group_month of the CURRENT month
 *     SELECT 1
 *       FROM sessions s
 *       JOIN group_months gm ON gm.id = s.group_month_id
 *       JOIN operating_months om ON om.id = gm.operating_month_id
 *      WHERE s.workspace_id = :ws
 *        AND s.origin = 'GENERATED'
 *        AND om.status = 'CURRENT'
 *      LIMIT 1
 *
 *   Step 5 — persisted attendance (INTENTIONALLY WORKSPACE-GLOBAL, per
 *   the product decision that a workspace which has recorded real
 *   attendance must never regress to "not started" when a new CURRENT
 *   month rolls over)
 *     SELECT 1 FROM session_records
 *      WHERE workspace_id = :ws
 *        AND attendance_status IN ('PRESENT','ABSENT','LATE')
 *      LIMIT 1
 */
import { and, eq, inArray } from "drizzle-orm";
import { operatingMonths } from "../schema/months";
import { groups, groupMonths, scheduleRules } from "../schema/groups";
import { enrollments } from "../schema/enrollments";
import { sessions } from "../schema/sessions";
import { sessionRecords } from "../schema/session-records";
import type { Db } from "../repositories/identity.repository";

export interface OnboardingSetupState {
  operatingMonth: boolean;
  groupSetup: boolean;
  students: boolean;
  sessions: boolean;
  attendance: boolean;
}

/**
 * Runs five bounded existence checks against the workspace's live state.
 * Callers scope the connection with `withRuntimeContext({workspaceId})`
 * so RLS applies as usual; the workspace_id is also passed in the WHERE
 * clauses because every table carries a denormalised `workspace_id` and
 * the read-model queries throughout this package rely on the same
 * belt-and-braces convention (see reports/action-center.repository.ts).
 */
export async function loadOnboardingSetupState(
  db: Db,
  workspaceId: string,
): Promise<OnboardingSetupState> {
  // Step 1 — CURRENT operating month exists.
  const [currentMonthRow] = await db
    .select({ id: operatingMonths.id })
    .from(operatingMonths)
    .where(
      and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, "CURRENT")),
    )
    .limit(1);
  const hasCurrentMonth = currentMonthRow !== undefined;

  // Steps 2–4 all share the same "bound to a CURRENT-month group_month"
  // filter. If there is no CURRENT month, every one of them is
  // structurally impossible — short-circuit to avoid four wasted joins
  // on a brand-new workspace's very first call.
  let hasGroupSetup = false;
  let hasActiveEnrollment = false;
  let hasGeneratedSession = false;

  if (hasCurrentMonth) {
    const [scheduleRow] = await db
      .select({ id: scheduleRules.id })
      .from(scheduleRules)
      .innerJoin(groupMonths, eq(groupMonths.id, scheduleRules.groupMonthId))
      .innerJoin(operatingMonths, eq(operatingMonths.id, groupMonths.operatingMonthId))
      .innerJoin(groups, eq(groups.id, groupMonths.groupId))
      .where(
        and(
          eq(operatingMonths.workspaceId, workspaceId),
          eq(operatingMonths.status, "CURRENT"),
          eq(groups.status, "ACTIVE"),
        ),
      )
      .limit(1);
    hasGroupSetup = scheduleRow !== undefined;

    const [enrollmentRow] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .innerJoin(groupMonths, eq(groupMonths.id, enrollments.groupMonthId))
      .innerJoin(operatingMonths, eq(operatingMonths.id, groupMonths.operatingMonthId))
      .where(
        and(
          eq(enrollments.workspaceId, workspaceId),
          eq(enrollments.status, "ACTIVE"),
          eq(operatingMonths.status, "CURRENT"),
        ),
      )
      .limit(1);
    hasActiveEnrollment = enrollmentRow !== undefined;

    const [sessionRow] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
      .innerJoin(operatingMonths, eq(operatingMonths.id, groupMonths.operatingMonthId))
      .where(
        and(
          eq(sessions.workspaceId, workspaceId),
          eq(sessions.origin, "GENERATED"),
          eq(operatingMonths.status, "CURRENT"),
        ),
      )
      .limit(1);
    hasGeneratedSession = sessionRow !== undefined;
  }

  // Step 5 — workspace-global attendance ever recorded. Deliberately
  // NOT scoped to the CURRENT month (see file-level docstring).
  const [attendanceRow] = await db
    .select({ id: sessionRecords.id })
    .from(sessionRecords)
    .where(
      and(
        eq(sessionRecords.workspaceId, workspaceId),
        inArray(sessionRecords.attendanceStatus, ["PRESENT", "ABSENT", "LATE"]),
      ),
    )
    .limit(1);
  const hasAttendance = attendanceRow !== undefined;

  return {
    operatingMonth: hasCurrentMonth,
    groupSetup: hasGroupSetup,
    students: hasActiveEnrollment,
    sessions: hasGeneratedSession,
    attendance: hasAttendance,
  };
}
