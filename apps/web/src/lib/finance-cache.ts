import type { QueryClient } from "@tanstack/react-query";
import { qk } from "./query-keys";

/**
 * Every cache a money movement (recording a payment, or CANCELLING a
 * recorded one) makes stale — in one place, so the two flows can never
 * drift apart again.
 *
 * The bug this closes was exactly that drift: `RecordPaymentDialog`
 * invalidated the whole client, while the cancel flow only refetched the
 * payment ledger it was opened from. The server was already correct
 * (`reversePaymentTransaction` recomputes `amount_paid_minor` /
 * `remaining_minor` / `status` inside the same transaction, and the API
 * aggregates read those stored columns — see the Finance service specs
 * "reversal restores the obligation's balances correctly"), so the ledger
 * showed the payment as cancelled while the summary cards on the SAME
 * page, the collection queue and the student's finance tab kept serving
 * the pre-cancel numbers from cache for a full `staleTime` (30s) — or
 * indefinitely on an SPA navigation, since `refetchOnWindowFocus` is off.
 *
 * These are query-key PREFIXES, matching react-query's own prefix
 * semantics, and they are derived from `qk` rather than hand-written
 * strings (the query-key factory's own stated contract):
 * - `finance`      — summary cards, collection queue, payment ledger
 * - `students`     — a student's obligations tab + their detail/list rows
 * - `action-center`— the dashboard's "تحصيل" decision section
 * - `reports`      — student/group/monthly financial figures
 *
 * Deliberately NOT invalidated: `sessions`, `groups`, `months`, `team`,
 * `billing` — no payment can change any of them, and a blanket
 * `invalidateQueries()` would refetch the whole screen on every payment.
 */
export function invalidateFinanceCaches(queryClient: QueryClient, workspaceId: string): void {
  const prefixes = [
    qk.finance.all(workspaceId),
    qk.students.all(workspaceId),
    qk.actionCenter.root(workspaceId),
    qk.reports.all(workspaceId),
  ];
  for (const queryKey of prefixes) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
