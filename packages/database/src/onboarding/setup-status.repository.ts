/**
 * Onboarding setup-status derivation — read-only aggregator over the
 * real workspace domain. Every raw state returns a plain boolean derived
 * from an `EXISTS`-equivalent `LIMIT 1` select on already-indexed
 * columns; no shadow completion table, no schema migration.
 *
 * FIVE raw business signals — separated so the API service can present
 * FOUR UX steps to the user while still exposing the `sessionsGenerated`
 * readiness signal for confidence copy without inventing a fake task:
 *
 *   groupExists — a durable Group exists on the workspace, entirely
 *   independent of any operating month. The `/groups` wizard bootstraps
 *   this before anything else, so this must be a first-class raw
 *   signal rather than being joined into the month predicate.
 *     SELECT 1 FROM groups
 *      WHERE workspace_id = :ws AND status = 'ACTIVE' LIMIT 1
 *
 *   operatingMonthPrepared — the CURRENT month has at least one
 *   group_month with at least one schedule rule. This is the state
 *   the /months/new confirm flow (or a group-wizard→prepare success)
 *   guarantees on completion.
 *     SELECT 1 FROM schedule_rules sr
 *       JOIN group_months gm ON gm.id = sr.group_month_id
 *       JOIN operating_months om ON om.id = gm.operating_month_id
 *       JOIN groups g ON g.id = gm.group_id
 *      WHERE om.workspace_id = :ws
 *        AND om.status = 'CURRENT'
 *        AND g.status = 'ACTIVE'
 *      LIMIT 1
 *
 *   studentsEnrolled — an ACTIVE enrollment sits on a group_month of
 *   the CURRENT month.
 *     SELECT 1 FROM enrollments e
 *       JOIN group_months gm ON gm.id = e.group_month_id
 *       JOIN operating_months om ON om.id = gm.operating_month_id
 *      WHERE e.workspace_id = :ws
 *        AND e.status = 'ACTIVE'
 *        AND om.status = 'CURRENT'
 *      LIMIT 1
 *
 *   sessionsGenerated — auto-generated sessions exist for the CURRENT
 *   month. SYSTEM-DERIVED — the user never triggers this directly; the
 *   client uses it to render a "your month's sessions are ready"
 *   confidence line under the prepareMonth step, NOT as a task.
 *     SELECT 1 FROM sessions s
 *       JOIN group_months gm ON gm.id = s.group_month_id
 *       JOIN operating_months om ON om.id = gm.operating_month_id
 *      WHERE s.workspace_id = :ws
 *        AND s.origin = 'GENERATED'
 *        AND om.status = 'CURRENT'
 *      LIMIT 1
 *
 *   attendanceRecorded — INTENTIONALLY WORKSPACE-GLOBAL, per the product
 *   decision that a workspace which has recorded real attendance must
 *   never regress to "not started" when a new CURRENT month rolls over.
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
  groupExists: boolean;
  operatingMonthPrepared: boolean;
  studentsEnrolled: boolean;
  sessionsGenerated: boolean;
  attendanceRecorded: boolean;
}

/**
 * Runs the raw existence checks against the workspace's live state.
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
  // Step 1 — a durable Group exists (independent of any month).
  const [groupRow] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.workspaceId, workspaceId), eq(groups.status, "ACTIVE")))
    .limit(1);
  const groupExists = groupRow !== undefined;

  // Steps 2–4 all share the "bound to a CURRENT-month group_month" filter.
  // If there's no CURRENT month, every one of them is structurally
  // impossible — short-circuit to skip four wasted joins on a fresh
  // workspace's very first call.
  const [currentMonthRow] = await db
    .select({ id: operatingMonths.id })
    .from(operatingMonths)
    .where(
      and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, "CURRENT")),
    )
    .limit(1);
  const hasCurrentMonth = currentMonthRow !== undefined;

  let operatingMonthPrepared = false;
  let studentsEnrolled = false;
  let sessionsGenerated = false;

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
    operatingMonthPrepared = scheduleRow !== undefined;

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
    studentsEnrolled = enrollmentRow !== undefined;

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
    sessionsGenerated = sessionRow !== undefined;
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
  const attendanceRecorded = attendanceRow !== undefined;

  return {
    groupExists,
    operatingMonthPrepared,
    studentsEnrolled,
    sessionsGenerated,
    attendanceRecorded,
  };
}
