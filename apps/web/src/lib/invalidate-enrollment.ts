import type { QueryClient } from "@tanstack/react-query";
import { qk } from "./query-keys";

/**
 * One place for the cache fan-out after an enrollment changes (§35): the
 * student's profile + history, the group's roster/summary report, the students
 * list, finance (a new obligation was created), and the action center (roster
 * changes feed it). Called from every enroll entry point so no surface goes
 * stale and no full-page reload is needed.
 */
export function invalidateAfterEnrollment(
  queryClient: QueryClient,
  workspaceId: string,
  opts: { studentId?: string; groupId?: string },
): void {
  queryClient.invalidateQueries({ queryKey: qk.students.list(workspaceId) });
  if (opts.studentId) {
    queryClient.invalidateQueries({ queryKey: qk.students.enrollments(workspaceId, opts.studentId) });
    queryClient.invalidateQueries({ queryKey: qk.students.obligations(workspaceId, opts.studentId) });
    queryClient.invalidateQueries({ queryKey: qk.reports.student(workspaceId, opts.studentId) });
  }
  if (opts.groupId) {
    queryClient.invalidateQueries({ queryKey: qk.reports.group(workspaceId, opts.groupId) });
  }
  queryClient.invalidateQueries({ queryKey: qk.finance.summary(workspaceId) });
  queryClient.invalidateQueries({ queryKey: qk.finance.collectionQueue(workspaceId) });
  queryClient.invalidateQueries({ queryKey: qk.actionCenter.root(workspaceId) });
}
