/**
 * Pure obligation due-date derivation — Phase 6. Mirrors
 * `scheduling/proration.ts`/`session-mode/roster.ts`'s convention (pure,
 * timezone-aware, no DB access, independently unit-testable).
 *
 * Database Schema §4.2/§5.4 documents `due_day` (1..28) as the resolved
 * day-of-month, but explicitly marks the UNIFIED/PER_GROUP/OVERRIDE
 * branching itself "وفق Product mapping النهائي" (pending final product
 * mapping) — not a decided algorithm. Rather than inventing that
 * branching, this function takes an ALREADY-RESOLVED `dueDay` (the
 * caller/service picks `groupMonth.dueDay ?? workspace.unifiedDueDay`,
 * the specificity-priority the data is already collected under since
 * Phase 3 — see `FinanceService`'s own doc comment for the exact
 * resolution order) and only does the uncontroversial part: turning
 * (year, month, dueDay) into a real calendar date in the workspace's
 * timezone, clamping to the last real day of a short month (e.g. day 30
 * in February).
 */
import { DateTime } from "luxon";

export function computeObligationDueDate(params: {
  year: number;
  month: number;
  dueDay: number;
  workspaceTimezone: string;
}): string {
  const firstOfMonth = DateTime.fromObject(
    { year: params.year, month: params.month, day: 1 },
    { zone: params.workspaceTimezone },
  );
  const daysInMonth = firstOfMonth.daysInMonth ?? 28;
  const clampedDay = Math.min(Math.max(Math.trunc(params.dueDay), 1), daysInMonth);
  const isoDate = firstOfMonth.set({ day: clampedDay }).toISODate();
  if (!isoDate) throw new Error("Failed to compute obligation due date.");
  return isoDate;
}
