import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Subscription admin actions — the two Product/Semantics guarantees:
 *
 *  1. REACTIVATE never grants time implicitly. It only restores a subscription
 *     whose saved `periodEnd` is still in the future (leaving that date
 *     UNCHANGED). If the period has already lapsed it refuses with
 *     `REACTIVATE_NEEDS_PERIOD` — staff must EXTEND_DAYS / SET_END_DATE first.
 *
 *  2. It never silently converts Trial<->Paid: EXTEND/SET_END keep the current
 *     state; REACTIVATE only sets ACTIVE.
 *
 * We mock the DB connection (feed a chosen `subscriptions` row) and the reused
 * `updateSubscriptionStateTransaction` (capture exactly what state/periodEnd the
 * admin action asks it to persist) — the point under test is the decision logic,
 * not Postgres itself.
 */

const state: {
  sub: Record<string, unknown> | undefined;
  captured: { nextState?: unknown; periodEnd?: unknown } | null;
} = { sub: undefined, captured: null };

vi.mock("../connection", () => {
  const makeTx = () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.sub ? [state.sub] : []),
        }),
      }),
    }),
    insert: () => ({ values: () => Promise.resolve(undefined) }),
  });
  const db = { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()) };
  return { getPlatformAdminDb: () => db, getDb: () => db };
});

vi.mock("./subscriptions.repository", () => ({
  SUBSCRIPTION_VERSION_CONFLICT: Symbol("SUBSCRIPTION_VERSION_CONFLICT"),
  updateSubscriptionStateTransaction: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    state.captured = { nextState: input.nextState, periodEnd: input.periodEnd };
    // Mirror the real helper: `periodEnd: undefined` leaves the stored value
    // unchanged, so the returned row keeps the subscription's existing period.
    const keptPeriodEnd = input.periodEnd === undefined ? state.sub?.periodEnd : input.periodEnd;
    return { state: input.nextState, periodEnd: keptPeriodEnd ?? null };
  }),
}));

import { applySubscriptionAdminAction } from "./platform-operations.repository";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  state.sub = undefined;
  state.captured = null;
});

function seedSub(overrides: Record<string, unknown>) {
  state.sub = {
    id: "sub-1",
    workspaceId: "ws-1",
    state: "ACTIVE",
    version: 3,
    periodEnd: null,
    ...overrides,
  };
}

describe("applySubscriptionAdminAction — REACTIVATE semantics", () => {
  it("restores a still-future period UNCHANGED and never adds implicit days", async () => {
    const futureEnd = new Date(Date.now() + 20 * DAY);
    seedSub({ state: "EXPIRED", periodEnd: futureEnd });

    const res = await applySubscriptionAdminAction({
      workspaceId: "ws-1",
      action: "REACTIVATE",
      reason: "customer paid offline",
      actorUserId: "admin-1",
    });

    expect(res).toEqual({ state: "ACTIVE", periodEnd: futureEnd.toISOString() });
    // Asked the transaction to keep the existing periodEnd (undefined = unchanged)
    expect(state.captured?.nextState).toBe("ACTIVE");
    expect(state.captured?.periodEnd).toBeUndefined();
  });

  it("refuses to reactivate an already-expired subscription (needs a new period first)", async () => {
    seedSub({ state: "EXPIRED", periodEnd: new Date(Date.now() - 5 * DAY) });

    const res = await applySubscriptionAdminAction({
      workspaceId: "ws-1",
      action: "REACTIVATE",
      reason: "attempt",
      actorUserId: "admin-1",
    });

    expect(res).toBe("REACTIVATE_NEEDS_PERIOD");
    // Never reached the write — no state change was attempted.
    expect(state.captured).toBeNull();
  });

  it("refuses to reactivate when no period was ever set", async () => {
    seedSub({ state: "EXPIRED", periodEnd: null });
    const res = await applySubscriptionAdminAction({
      workspaceId: "ws-1",
      action: "REACTIVATE",
      reason: "attempt",
      actorUserId: "admin-1",
    });
    expect(res).toBe("REACTIVATE_NEEDS_PERIOD");
  });
});

describe("applySubscriptionAdminAction — no silent Trial<->Paid conversion", () => {
  it("EXTEND_DAYS keeps a Trial a Trial (only pushes the end date out)", async () => {
    const start = new Date(Date.now() + 2 * DAY);
    seedSub({ state: "TRIAL", periodEnd: start });

    await applySubscriptionAdminAction({
      workspaceId: "ws-1",
      action: "EXTEND_DAYS",
      reason: "grace",
      days: 7,
      actorUserId: "admin-1",
    });

    expect(state.captured?.nextState).toBe("TRIAL");
    expect(state.captured?.periodEnd).toEqual(new Date(start.getTime() + 7 * DAY));
  });

  it("SET_END_DATE keeps a paid ACTIVE subscription ACTIVE", async () => {
    seedSub({ state: "ACTIVE", periodEnd: new Date(Date.now() + 10 * DAY) });
    const newEnd = new Date(Date.now() + 40 * DAY);

    await applySubscriptionAdminAction({
      workspaceId: "ws-1",
      action: "SET_END_DATE",
      reason: "annual",
      endDate: newEnd,
      actorUserId: "admin-1",
    });

    expect(state.captured?.nextState).toBe("ACTIVE");
    expect(state.captured?.periodEnd).toEqual(newEnd);
  });
});
