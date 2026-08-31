import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * Platform Staff Management invariants (mocked DB connection — the point under
 * test is the decision logic, not Postgres): last-active-owner protection,
 * single-use / expiry / email-binding on accept, and that every successful
 * mutation writes a platform_audit_events row.
 *
 * The fake tx feeds scripted rows to each SELECT (in call order) and records
 * every INSERT so tests can assert the audit write happened.
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

import { acceptStaffInvitationTx, changePlatformStaffRole, setPlatformStaffStatus } from "./platform-staff.repository";

const auditActions = () => state.inserts.map((i) => i.action).filter(Boolean);

beforeEach(() => {
  state.selects = [];
  state.updateReturning = [];
  state.insertReturning = [];
  state.inserts = [];
});

describe("changePlatformStaffRole — last-owner protection", () => {
  it("blocks demoting the LAST active PLATFORM_OWNER", async () => {
    state.selects = [[{ role: "PLATFORM_OWNER", status: "ACTIVE" }], [{ n: 1 }]];
    const res = await changePlatformStaffRole({ targetUserId: "t", newRole: "OPERATIONS_ADMIN", actorUserId: "a", reason: "x" });
    expect(res).toEqual({ ok: false, reason: "LAST_OWNER" });
    expect(auditActions()).toEqual([]); // no write happened
  });

  it("allows the demotion when another active owner exists, and audits it", async () => {
    state.selects = [[{ role: "PLATFORM_OWNER", status: "ACTIVE" }], [{ n: 2 }]];
    const res = await changePlatformStaffRole({ targetUserId: "t", newRole: "OPERATIONS_ADMIN", actorUserId: "a", reason: "x" });
    expect(res).toMatchObject({ ok: true, role: "OPERATIONS_ADMIN" });
    expect(auditActions()).toContain("platform.staff.role_changed");
  });
});

describe("setPlatformStaffStatus — last-owner protection", () => {
  it("blocks disabling the LAST active PLATFORM_OWNER", async () => {
    state.selects = [[{ role: "PLATFORM_OWNER", status: "ACTIVE" }], [{ n: 1 }]];
    const res = await setPlatformStaffStatus({ targetUserId: "t", action: "DISABLE", actorUserId: "a", reason: "x" });
    expect(res).toEqual({ ok: false, reason: "LAST_OWNER" });
  });

  it("disables a non-owner and audits it", async () => {
    state.selects = [[{ role: "SUPPORT_AGENT", status: "ACTIVE" }]];
    const res = await setPlatformStaffStatus({ targetUserId: "t", action: "DISABLE", actorUserId: "a", reason: "x" });
    expect(res).toMatchObject({ ok: true, status: "DISABLED" });
    expect(auditActions()).toContain("platform.staff.disabled");
  });
});

describe("acceptStaffInvitationTx — single-use / expiry / email binding", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("rejects an EXPIRED invitation", async () => {
    state.selects = [[{ id: "inv", status: "PENDING", expiresAt: past, email: "x@y.com", role: "SUPPORT_AGENT", invitedByUserId: "i" }]];
    const res = await acceptStaffInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "x@y.com" });
    expect(res).toEqual({ ok: false, reason: "INVALID" });
  });

  it("rejects a REUSED (already-ACCEPTED) invitation", async () => {
    state.selects = [[{ id: "inv", status: "ACCEPTED", expiresAt: future, email: "x@y.com", role: "SUPPORT_AGENT", invitedByUserId: "i" }]];
    const res = await acceptStaffInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "x@y.com" });
    expect(res).toEqual({ ok: false, reason: "INVALID" });
  });

  it("rejects a mismatched email (token alone can't grant a different account)", async () => {
    state.selects = [[{ id: "inv", status: "PENDING", expiresAt: future, email: "invited@y.com", role: "SUPPORT_AGENT", invitedByUserId: "i" }]];
    const res = await acceptStaffInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "someone-else@y.com" });
    expect(res).toEqual({ ok: false, reason: "EMAIL_MISMATCH" });
  });

  it("rejects when the accepter is ALREADY a platform admin", async () => {
    state.selects = [
      [{ id: "inv", status: "PENDING", expiresAt: future, email: "x@y.com", role: "OPERATIONS_ADMIN", invitedByUserId: "i" }],
      [{ id: "existing-admin" }],
    ];
    const res = await acceptStaffInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "x@y.com" });
    expect(res).toEqual({ ok: false, reason: "ALREADY_ADMIN" });
  });

  it("accepts ONCE: claims the invite, inserts the platform_admins row, and audits", async () => {
    state.selects = [
      [{ id: "inv", status: "PENDING", expiresAt: future, email: "x@y.com", role: "OPERATIONS_ADMIN", invitedByUserId: "i" }],
      [], // no existing admin
    ];
    state.updateReturning = [[{ id: "inv" }]]; // atomic claim succeeds
    const res = await acceptStaffInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "X@Y.com" });
    expect(res).toEqual({ ok: true, role: "OPERATIONS_ADMIN" });
    // A platform_admins row was inserted ACTIVE with the invited role...
    const adminInsert = state.inserts.find((i) => i.role === "OPERATIONS_ADMIN");
    expect(adminInsert).toMatchObject({ userId: "u", role: "OPERATIONS_ADMIN", status: "ACTIVE" });
    // ...and the acceptance was audited.
    expect(auditActions()).toContain("platform.staff.invite_accepted");
  });

  it("fails closed if the atomic claim matches 0 rows (lost the race)", async () => {
    state.selects = [
      [{ id: "inv", status: "PENDING", expiresAt: future, email: "x@y.com", role: "SUPPORT_AGENT", invitedByUserId: "i" }],
      [],
    ];
    state.updateReturning = [[]]; // claim matched nothing
    const res = await acceptStaffInvitationTx({ tokenHash: "h", accepterUserId: "u", accepterEmail: "x@y.com" });
    expect(res).toEqual({ ok: false, reason: "INVALID" });
  });
});
