"use client";

import { useQuery } from "@tanstack/react-query";
import type { GroupMonth } from "@academic-precision/contracts";
import { fetchMonths, fetchGroupMonthsForMonth } from "./api/scheduling";
import { qk } from "./query-keys";
import { useWorkspace } from "./workspace-provider";

/**
 * Resolves the GroupMonth a Student would enroll into for a given Group —
 * enrollment is anchored to a GroupMonth, not a Group (schema
 * `enrollments.group_month_id`), and only the workspace's CURRENT operating
 * month is a valid enroll target. Three outcomes drive the enroll UX:
 *   - NO_CURRENT_MONTH — no CURRENT operating month exists yet (create one first).
 *   - NOT_PREPARED     — a CURRENT month exists but this group isn't attached to
 *                        it (needs prepare-current-month = fee + schedule; that
 *                        lives in the Group Wizard, not invented here).
 *   - READY            — the group's GroupMonth for this month, ready to enroll.
 * Reuses the same two reads the rest of the app uses (no bespoke endpoint).
 */
export type CurrentGroupMonthState =
  | { status: "LOADING" }
  | { status: "NO_CURRENT_MONTH"; groupMonth: null }
  | { status: "NOT_PREPARED"; groupMonth: null }
  | { status: "READY"; groupMonth: GroupMonth };

export function useCurrentGroupMonth(groupId: string | null | undefined): {
  state: CurrentGroupMonthState;
  isLoading: boolean;
  isError: boolean;
} {
  const { workspaceId } = useWorkspace();

  const monthsQuery = useQuery({
    queryKey: workspaceId ? qk.months.list(workspaceId) : ["months", "none"],
    queryFn: () => fetchMonths(workspaceId!),
    enabled: !!workspaceId && !!groupId,
  });

  const currentMonth = monthsQuery.data?.months.find((m) => m.status === "CURRENT") ?? null;

  const groupMonthsQuery = useQuery({
    queryKey: workspaceId && currentMonth ? qk.months.groupMonths(workspaceId, currentMonth.id) : ["group-months", "none"],
    queryFn: () => fetchGroupMonthsForMonth(workspaceId!, currentMonth!.id),
    enabled: !!workspaceId && !!groupId && !!currentMonth,
  });

  const isLoading = !!groupId && (monthsQuery.isLoading || (!!currentMonth && groupMonthsQuery.isLoading));
  const isError = monthsQuery.isError || groupMonthsQuery.isError;

  let state: CurrentGroupMonthState = { status: "LOADING" };
  if (!groupId || isLoading) {
    state = { status: "LOADING" };
  } else if (!currentMonth) {
    state = { status: "NO_CURRENT_MONTH", groupMonth: null };
  } else if (groupMonthsQuery.data) {
    const gm = groupMonthsQuery.data.groupMonths.find((g) => g.groupId === groupId) ?? null;
    state = gm ? { status: "READY", groupMonth: gm } : { status: "NOT_PREPARED", groupMonth: null };
  }

  return { state, isLoading, isError };
}
