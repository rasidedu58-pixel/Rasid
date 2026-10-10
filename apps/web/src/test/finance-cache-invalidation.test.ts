import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { qk } from "../lib/query-keys";
import { invalidateFinanceCaches } from "../lib/finance-cache";

/**
 * Regression test for the reported money bug: a cancelled payment was still
 * counted as collected.
 *
 * The server was never wrong — `reversePaymentTransaction` recomputes
 * `amount_paid_minor` / `remaining_minor` / `status` inside the same
 * transaction (and the API's finance spec already pins "reversal restores
 * the obligation's balances correctly" plus "reversing the same payment
 * twice is rejected"). What was wrong was the client: the cancel flow only
 * refetched the payment ledger it was opened from, so the summary cards on
 * the SAME page, the collection queue, the student's finance tab, the
 * dashboard's collection section and the reports all kept serving pre-cancel
 * numbers from cache (`staleTime` 30s, `refetchOnWindowFocus` off).
 *
 * So the thing to pin is exactly that: one money movement invalidates every
 * cache that displays a balance — and nothing else.
 */
const WS = "ws-1";
const OTHER_WS = "ws-2";

function seed(client: QueryClient, key: readonly unknown[]) {
  client.setQueryData(key, { seeded: true });
}

function invalidated(client: QueryClient, key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true;
}

describe("invalidateFinanceCaches", () => {
  it("invalidates every cache that shows a balance after a payment is recorded or cancelled", () => {
    const client = new QueryClient();
    const affected = [
      qk.finance.summary(WS),
      qk.finance.ledger(WS, { method: undefined, status: undefined }),
      qk.finance.collectionQueue(WS),
      qk.students.obligations(WS, "student-1"),
      qk.students.detail(WS, "student-1"),
      qk.actionCenter.root(WS),
      qk.reports.student(WS, "student-1"),
      qk.reports.monthly(WS, "month-1"),
    ];
    for (const key of affected) seed(client, key);

    invalidateFinanceCaches(client, WS);

    for (const key of affected) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(true);
    }
  });

  it("leaves caches a payment cannot change alone — no blanket refetch of the whole screen", () => {
    const client = new QueryClient();
    const untouched = [
      qk.sessions.list(WS),
      qk.sessions.calendar(WS, "2026-10-01", "2026-10-31"),
      qk.groups.list(WS),
      qk.months.list(WS),
      qk.team.list(WS),
      qk.billing.subscription(WS),
      qk.notifications.list(WS),
    ];
    for (const key of untouched) seed(client, key);

    invalidateFinanceCaches(client, WS);

    for (const key of untouched) {
      expect(invalidated(client, key), JSON.stringify(key)).toBe(false);
    }
  });

  it("never reaches another workspace's cached balances", () => {
    const client = new QueryClient();
    seed(client, qk.finance.summary(OTHER_WS));
    seed(client, qk.students.obligations(OTHER_WS, "student-9"));

    invalidateFinanceCaches(client, WS);

    expect(invalidated(client, qk.finance.summary(OTHER_WS))).toBe(false);
    expect(invalidated(client, qk.students.obligations(OTHER_WS, "student-9"))).toBe(false);
  });
});
