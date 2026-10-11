/**
 * The two outbox-driven notifications, against a fake transaction.
 *
 * What is actually being asserted is the part that can silently be wrong: WHO
 * receives it, WHETHER it is emitted at all, and — the requirement the real
 * `notifications_dedup_unique` index enforces — that a redelivered event never
 * produces a second row. The fake therefore enforces the same unique key the
 * database does, so "retry does not duplicate" is a real assertion rather than
 * a restatement of the production SQL.
 */
import { describe, expect, it } from "vitest";
import { emitPaymentRequestCreatedNotification, emitTeamInviteAcceptedNotification } from "./notification-events";
import { workspaces } from "../schema/workspaces";
import { paymentRequests } from "../schema/payment-requests";
import { platformAdmins } from "../schema/platform-admin";
import type { Db } from "../repositories/identity.repository";

interface InsertedRow {
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  dedupKey: string;
}

/** The real `notifications_dedup_unique` key, so ON CONFLICT DO NOTHING is modelled rather than assumed. */
const dedupOf = (r: InsertedRow): string => [r.userId, r.type, r.entityType, r.entityId, r.dedupKey].join("|");

function makeFakeTx(rowsByTable: Map<unknown, unknown[]>) {
  const inserted: InsertedRow[] = [];
  const seen = new Set<string>();

  const selectBuilder = () => {
    let rows: unknown[] = [];
    const builder: Record<string, unknown> = {
      from(table: unknown) {
        rows = rowsByTable.get(table) ?? [];
        return builder;
      },
      where: () => builder,
      limit: () => builder,
      then: (resolve: (v: unknown[]) => unknown) => resolve(rows),
    };
    return builder;
  };

  const tx = {
    select: () => selectBuilder(),
    insert: () => {
      let pending: InsertedRow;
      const builder: Record<string, unknown> = {
        values(v: InsertedRow) {
          pending = v;
          return builder;
        },
        onConflictDoNothing: () => builder,
        returning: () => {
          const key = dedupOf(pending);
          if (seen.has(key)) return Promise.resolve([]);
          seen.add(key);
          inserted.push(pending);
          return Promise.resolve([{ inserted: true }]);
        },
      };
      return builder;
    },
  } as unknown as Db;

  return { tx, inserted };
}

const WORKSPACE = { id: "ws-1", name: "أكاديمية النور", ownerUserId: "owner-1" };

// ---------------------------------------------------------------------------
// 1. Invitation accepted
// ---------------------------------------------------------------------------

describe("TeamInvitationAccepted — «تم انضمام عضو جديد للفريق»", () => {
  const event = {
    workspaceId: WORKSPACE.id,
    payload: { membershipId: "mem-1", recipientUserId: "owner-1", memberName: "محمد أحمد" },
  };
  const tables = () => new Map<unknown, unknown[]>([[workspaces, [WORKSPACE]]]);

  it("notifies the person who authorized the invitation, once, naming the member", async () => {
    const { tx, inserted } = makeFakeTx(tables());
    expect(await emitTeamInviteAcceptedNotification(tx, event)).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: "owner-1",
      type: "TEAM_INVITE_ACCEPTED",
      title: "تم انضمام عضو جديد للفريق",
      entityType: "workspace_membership",
      entityId: "mem-1",
      dedupKey: "mem-1",
    });
    expect(inserted[0]!.body).toContain("محمد أحمد");
    expect(inserted[0]!.body).toContain(WORKSPACE.name);
  });

  it("a redelivered event (reclaimed lease / replayed DEAD row) creates no second notification", async () => {
    const { tx, inserted } = makeFakeTx(tables());
    await emitTeamInviteAcceptedNotification(tx, event);
    expect(await emitTeamInviteAcceptedNotification(tx, event)).toBe(0);
    expect(inserted).toHaveLength(1);
  });

  it("falls back to the workspace owner when the inviter is gone", async () => {
    const { tx, inserted } = makeFakeTx(tables());
    await emitTeamInviteAcceptedNotification(tx, {
      workspaceId: WORKSPACE.id,
      payload: { membershipId: "mem-2", recipientUserId: null, memberName: null },
    });
    expect(inserted[0]!.userId).toBe("owner-1");
    // No name in the payload must not produce an empty sentence.
    expect(inserted[0]!.body).toContain("عضو جديد");
  });

  it("emits nothing without a membership id — the proof that someone actually joined", async () => {
    const { tx, inserted } = makeFakeTx(tables());
    expect(await emitTeamInviteAcceptedNotification(tx, { workspaceId: WORKSPACE.id, payload: {} })).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Payment request created
// ---------------------------------------------------------------------------

describe("PaymentRequestCreated — «طلب دفع جديد يحتاج مراجعة»", () => {
  const REQUEST = { id: "pr-1", humanCode: "RS-ABC123", amountMinor: 30000, targetPlanCode: "PROFESSIONAL", status: "PENDING" };
  const STAFF = [{ userId: "staff-1" }, { userId: "staff-2" }];
  const event = { workspaceId: WORKSPACE.id, payload: { paymentRequestId: "pr-1", requestedByName: "أ. سارة" } };
  const tables = (request: unknown = REQUEST, staff: unknown[] = STAFF) =>
    new Map<unknown, unknown[]>([
      [workspaces, [WORKSPACE]],
      [paymentRequests, [request]],
      [platformAdmins, staff],
    ]);

  it("notifies every active staff member once, naming the requester, the plan and the amount", async () => {
    const { tx, inserted } = makeFakeTx(tables());
    expect(await emitPaymentRequestCreatedNotification(tx, event)).toBe(2);
    expect(inserted.map((r) => r.userId)).toEqual(["staff-1", "staff-2"]);
    expect(inserted[0]).toMatchObject({
      type: "NEW_PAYMENT_PROOF_PENDING",
      title: "طلب دفع جديد يحتاج مراجعة",
      entityType: "payment_request",
      entityId: "pr-1",
      dedupKey: "pr-1",
    });
    expect(inserted[0]!.body).toContain("أ. سارة");
    expect(inserted[0]!.body).toContain(WORKSPACE.name);
    expect(inserted[0]!.body).toContain("احترافي");
    expect(inserted[0]!.body).toContain("300 ج.م");
    expect(inserted[0]!.body).toContain("RS-ABC123");
  });

  it("a retried creation of the SAME request adds nothing — one notification per request per staff member", async () => {
    const { tx, inserted } = makeFakeTx(tables());
    await emitPaymentRequestCreatedNotification(tx, event);
    expect(await emitPaymentRequestCreatedNotification(tx, event)).toBe(0);
    expect(inserted).toHaveLength(2);
  });

  it("stays silent for a request that is no longer PENDING — nothing left for a human to review", async () => {
    const { tx, inserted } = makeFakeTx(tables({ ...REQUEST, status: "CONFIRMED" }));
    expect(await emitPaymentRequestCreatedNotification(tx, event)).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("falls back to the workspace name when the payload carries no requester name", async () => {
    const { tx, inserted } = makeFakeTx(tables());
    await emitPaymentRequestCreatedNotification(tx, {
      workspaceId: WORKSPACE.id,
      payload: { paymentRequestId: "pr-1", requestedByName: null },
    });
    expect(inserted[0]!.body).toContain(WORKSPACE.name);
  });

  it("emits nothing when there is no active staff member to review it", async () => {
    const { tx, inserted } = makeFakeTx(tables(REQUEST, []));
    expect(await emitPaymentRequestCreatedNotification(tx, event)).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});
