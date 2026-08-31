import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Audit atomicity — item 5. Every sensitive Unit 1 write appends a
 * platform_audit_event INSIDE the same db.transaction as the business write.
 * These tests prove the code AWAITS the audit insert and PROPAGATES its failure
 * (never swallows it): if the audit write fails, the whole operation rejects, so
 * no caller ever observes a successful business write without an audit row. The
 * real Postgres rollback of the already-issued business INSERT is guaranteed by
 * that single wrapping transaction (a transaction that throws rolls back).
 */

const state = { businessInsertAttempts: 0, resolved: false };

// The fake tx: business inserts succeed; any audit insert (values carry
// `action`+`targetType`) rejects — simulating an audit-write failure.
vi.mock("../connection", () => {
  const makeTx = () => ({
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        const isAudit = "action" in vals && "targetType" in vals;
        if (isAudit) return Promise.reject(new Error("audit write failed"));
        state.businessInsertAttempts += 1;
        return {
          returning: () =>
            Promise.resolve([
              {
                id: "row-1",
                workspaceId: vals.workspaceId ?? "ws-1",
                channel: vals.channel ?? "CALL",
                direction: vals.direction ?? "OUTBOUND",
                summary: vals.summary ?? "s",
                occurredAt: vals.occurredAt ?? new Date(),
                createdAt: new Date(),
                createdByUserId: vals.createdByUserId ?? null,
                title: vals.title ?? "t",
              },
            ]),
        };
      },
    }),
  });
  const db = { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(makeTx()) };
  return { getPlatformAdminDb: () => db, getDb: () => db };
});

import { createContactLog, createFollowUp } from "./platform-operations.repository";

beforeEach(() => {
  state.businessInsertAttempts = 0;
  state.resolved = false;
});

describe("Unit 1 write audit atomicity", () => {
  it("createContactLog rejects (no successful return) when the audit write fails", async () => {
    await expect(
      createContactLog({ workspaceId: "ws-1", channel: "CALL", direction: "OUTBOUND", summary: "hi", actorUserId: "u-1" }).then(() => {
        state.resolved = true;
      }),
    ).rejects.toThrow("audit write failed");
    expect(state.resolved).toBe(false); // never resolved a business success
    expect(state.businessInsertAttempts).toBe(1); // business insert was issued inside the tx that then rolls back
  });

  it("createFollowUp rejects when the audit write fails", async () => {
    await expect(createFollowUp({ workspaceId: "ws-1", title: "call back", actorUserId: "u-1" })).rejects.toThrow("audit write failed");
  });
});
