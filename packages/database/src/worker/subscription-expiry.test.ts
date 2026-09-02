import { describe, expect, it } from "vitest";
import { shouldExpireByLedger } from "./subscription-expiry";
import { paidThroughMs, type LedgerPeriodRow } from "../billing/period-ledger";

const row = (over: Partial<LedgerPeriodRow>): LedgerPeriodRow => ({
  id: "r", seq: 1, planCode: "PROFESSIONAL", billingCycle: "MONTHLY", cyclePriceMinor: 30000, planPriceVersion: 1,
  customMaxActiveStudents: null, customMaxTeamMembers: null,
  periodStartMs: 0, periodEndMs: 0, nominalCycleStartMs: 0, nominalCycleEndMs: 0, ...over,
});

/**
 * The pure future-paid guard. The transactional scan is proven against real
 * Postgres in the integration suite; here we pin the correctness-critical rule
 * that a prepaid future period is NEVER expired.
 */
describe("shouldExpireByLedger — never expire a prepaid subscription", () => {
  it("expires when there is no ledger paid-through (e.g. a TRIAL)", () => {
    expect(shouldExpireByLedger({ paidThroughMs: null, nowMs: 1000 })).toBe(true);
  });
  it("expires when paid-through is at/behind now", () => {
    expect(shouldExpireByLedger({ paidThroughMs: 900, nowMs: 1000 })).toBe(true);
    expect(shouldExpireByLedger({ paidThroughMs: 1000, nowMs: 1000 })).toBe(true);
  });
  it("does NOT expire when a future paid period still covers (paid-through after now)", () => {
    expect(shouldExpireByLedger({ paidThroughMs: 2000, nowMs: 1000 })).toBe(false);
  });
});

describe("ledger-backed future-paid expiry — a prepaid future period prevents EXPIRED", () => {
  const NOW = 1_000_000;
  it("current period at its boundary + a future paid period → NOT expirable (ledger paid-through is in the future)", () => {
    // Current period [now-30d, now], and a prepaid future period [now, now+30d] (e.g. an early renewal).
    const rows: LedgerPeriodRow[] = [
      row({ id: "cur", seq: 1, periodStartMs: NOW - 30 * 86400000, periodEndMs: NOW }),
      row({ id: "fut", seq: 2, periodStartMs: NOW, periodEndMs: NOW + 30 * 86400000 }),
    ];
    const paid = paidThroughMs(rows);
    expect(paid).toBe(NOW + 30 * 86400000); // paid-through is the future period's end
    expect(shouldExpireByLedger({ paidThroughMs: paid, nowMs: NOW })).toBe(false); // → worker skips: no EXPIRED, no false SUBSCRIPTION_EXPIRED notification
  });
  it("current period lapsed with NO future period → expirable (paid-through ≤ now)", () => {
    const rows: LedgerPeriodRow[] = [row({ id: "cur", seq: 1, periodStartMs: NOW - 60 * 86400000, periodEndMs: NOW - 1 })];
    expect(shouldExpireByLedger({ paidThroughMs: paidThroughMs(rows), nowMs: NOW })).toBe(true);
  });
});
