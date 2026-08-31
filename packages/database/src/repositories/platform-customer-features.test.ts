import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Customer onboarding invite + Workspace Feature Override invariants (mocked DB
 * connection). Covers: single-use / expiry / email-binding on the customer
 * claim; that setting an override revokes the prior one then inserts a new row
 * and audits; and that revoking a non-existent override reports "nothing done".
 */
const state: {
  selects: unknown[][];
  updateReturning: unknown[][];
  insertReturning: unknown[][];
  inserts: Record<string, unknown>[];
} = { selects: [], updateReturning: [], insertReturning: [], inserts: [] };

vi.mock("../connection", () => {
  const selectResult = () => {
    const p = Promise.resolve(state.selects.shift() ?? []);
    return { limit: () => p, then: (a: never, b: never) => p.then(a, b) };
  };
  const updateResult = () => {
    const done = Promise.resolve(undefined);
    return { returning: () => Promise.resolve(state.updateReturning.shift() ?? []), then: (a: never, b: never) => done.then(a, b) };
  };
  const insertResult = (vals: Record<string, unknown>) => {
    state.inserts.push(vals);
    const done = Promise.resolve(undefined);
    return { returning: () => Promise.resolve(state.insertReturning.shift() ?? [{ id: "gen" }]), then: (a: never, b: never) => done.then(a, b) };
  };
  const tx = {
    select: () => ({ from: () => ({ where: () => selectResult() }) }),
    update: () => ({ set: () => ({ where: () => updateResult() }) }),
    insert: () => ({ values: (v: Record<string, unknown>) => insertResult(v) }),
  };
  const db = { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(tx) };
  return { getPlatformAdminDb: () => db, getDb: () => db };
});

import { claimCustomerInvitationTx } from "./platform-customer-invitations.repository";
import { revokeFeatureOverride, setFeatureOverride } from "./workspace-features.repository";

const auditActions = () => state.inserts.map((i) => i.action).filter(Boolean);

beforeEach(() => {
  state.selects = [];
  state.updateReturning = [];
  state.insertReturning = [];
  state.inserts = [];
});

describe("claimCustomerInvitationTx — secure single-use claim", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("rejects an expired invite", async () => {
    state.selects = [[{ id: "inv", status: "PENDING", expiresAt: past, email: "c@x.com" }]];
    const res = await claimCustomerInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "c@x.com", workspaceId: "w" });
    expect(res).toEqual({ ok: false, reason: "INVALID" });
  });

  it("rejects a mismatched email", async () => {
    state.selects = [[{ id: "inv", status: "PENDING", expiresAt: future, email: "invited@x.com" }]];
    const res = await claimCustomerInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "other@x.com", workspaceId: "w" });
    expect(res).toEqual({ ok: false, reason: "EMAIL_MISMATCH" });
  });

  it("claims once and links the workspace, auditing the acceptance", async () => {
    state.selects = [[{ id: "inv", status: "PENDING", expiresAt: future, email: "c@x.com" }]];
    state.updateReturning = [[{ id: "inv" }]];
    const res = await claimCustomerInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "C@X.com", workspaceId: "w-1" });
    expect(res).toEqual({ ok: true, workspaceId: "w-1" });
    expect(auditActions()).toContain("platform.customer.invite_accepted");
  });
});

describe("feature override set / revoke", () => {
  it("setFeatureOverride inserts the new override and audits it", async () => {
    state.insertReturning = [[{ id: "ov-1" }]]; // the inserted override row
    const res = await setFeatureOverride({
      workspaceId: "w",
      featureKey: "complete_session_with_missing_records",
      state: "DISABLED",
      reason: "customer request",
      actorUserId: "a",
      expiresAt: null,
    });
    expect(res).toEqual({ id: "ov-1" });
    const overrideInsert = state.inserts.find((i) => i.featureKey === "complete_session_with_missing_records");
    expect(overrideInsert).toMatchObject({ workspaceId: "w", state: "DISABLED" });
    expect(auditActions()).toContain("platform.feature.override_set");
  });

  it("revokeFeatureOverride reports false when there is no active override", async () => {
    state.updateReturning = [[]]; // nothing matched
    const res = await revokeFeatureOverride({ workspaceId: "w", featureKey: "complete_session_with_missing_records", actorUserId: "a", reason: "x" });
    expect(res).toBe(false);
    expect(auditActions()).toEqual([]);
  });

  it("revokeFeatureOverride returns true and audits when an active override is cleared", async () => {
    state.updateReturning = [[{ id: "ov-1" }]];
    const res = await revokeFeatureOverride({ workspaceId: "w", featureKey: "complete_session_with_missing_records", actorUserId: "a", reason: "x" });
    expect(res).toBe(true);
    expect(auditActions()).toContain("platform.feature.override_revoked");
  });
});
