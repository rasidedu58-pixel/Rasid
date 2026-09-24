/**
 * PlatformLeadsService — unit tests over a mocked database layer. Proves the
 * SERVICE contract: the named UI filter maps to the right repository params,
 * rows map to DTOs (dates→ISO, the paid-subscription hint), the update body is
 * validated (no-change refused), and a missing lead surfaces as 404. The DB
 * behaviour itself (idempotent signup hook, priority ordering, audit) is
 * covered by the real-Postgres integration suite in @academic-precision/database.
 */
jest.mock("@academic-precision/database", () => ({
  listPlatformLeads: jest.fn(),
  getPlatformLeadMetrics: jest.fn(),
  updatePlatformLead: jest.fn(),
}));

import { getPlatformLeadMetrics, listPlatformLeads, updatePlatformLead } from "@academic-precision/database";
import { PlatformLeadsService } from "./platform-leads.service";
import { ResourceNotFoundException, ValidationApiException } from "../../common/exceptions/api.exception";

const mockList = listPlatformLeads as jest.Mock;
const mockMetrics = getPlatformLeadMetrics as jest.Mock;
const mockUpdate = updatePlatformLead as jest.Mock;

function row(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "lead-1",
    workspaceId: "ws-1",
    workspaceName: "حلقة النور",
    ownerUserId: "user-1",
    ownerName: "أحمد",
    ownerPhone: "01012345678",
    ownerEmail: "a@example.test",
    status: "NEW",
    lastContactAt: null,
    nextFollowUpAt: null,
    note: null,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedByName: null,
    subscriptionState: "TRIAL",
    subscriptionPlanCode: null,
    trialEndsAt: new Date("2026-09-15T10:00:00.000Z"),
    ...over,
  };
}

describe("PlatformLeadsService.listLeads — filter → repo params", () => {
  const service = new PlatformLeadsService();
  beforeEach(() => {
    jest.clearAllMocks();
    mockList.mockResolvedValue({ items: [], hasNext: false });
  });

  it("maps NEW filter to a status filter", async () => {
    await service.listLeads({ filter: "NEW" });
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ statuses: ["NEW"] }));
  });

  it("maps NEEDS_FOLLOW_UP to needsFollowUp=true", async () => {
    await service.listLeads({ filter: "NEEDS_FOLLOW_UP" });
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ needsFollowUp: true }));
  });

  it("maps POSTPONED / CONTACTED / CONVERTED to their status", async () => {
    await service.listLeads({ filter: "POSTPONED" });
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ["POSTPONED"] }));
    await service.listLeads({ filter: "CONTACTED" });
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ["CONTACTED"] }));
    await service.listLeads({ filter: "CONVERTED" });
    expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ statuses: ["CONVERTED"] }));
  });

  it("ALL / unknown filter applies no status/needsFollowUp constraint but forwards search+limit", async () => {
    await service.listLeads({ filter: "ALL", search: "احمد", limit: 20 });
    const arg = mockList.mock.calls[0][0];
    expect(arg.statuses).toBeUndefined();
    expect(arg.needsFollowUp).toBeUndefined();
    expect(arg.search).toBe("احمد");
    expect(arg.limit).toBe(20);
  });

  it("passes hasNext through and always returns a null cursor (V1 single page)", async () => {
    mockList.mockResolvedValue({ items: [], hasNext: true });
    const res = await service.listLeads({});
    expect(res.page).toEqual({ nextCursor: null, hasNext: true });
  });
});

describe("PlatformLeadsService.listLeads — row → DTO", () => {
  const service = new PlatformLeadsService();
  beforeEach(() => jest.clearAllMocks());

  it("serializes dates to ISO and flags a paid subscription only when ACTIVE + planCode", async () => {
    mockList.mockResolvedValue({
      items: [
        row({ id: "l1", subscriptionState: "ACTIVE", subscriptionPlanCode: "PRO", trialEndsAt: null }),
        row({ id: "l2", subscriptionState: "ACTIVE", subscriptionPlanCode: null }),
        row({ id: "l3", subscriptionState: "TRIAL", subscriptionPlanCode: null }),
      ],
      hasNext: false,
    });
    const { items } = await service.listLeads({});
    expect(items[0]!.hasActivePaidSubscription).toBe(true);
    expect(items[1]!.hasActivePaidSubscription).toBe(false); // ACTIVE but no plan
    expect(items[2]!.hasActivePaidSubscription).toBe(false); // TRIAL
    expect(items[0]!.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(items[2]!.trialEndsAt).toBe("2026-09-15T10:00:00.000Z");
    // No PII beyond the live-joined display fields; owner id preserved.
    expect(items[0]!.ownerUserId).toBe("user-1");
  });
});

describe("PlatformLeadsService.getMetrics", () => {
  it("returns the repository metrics untouched", async () => {
    const service = new PlatformLeadsService();
    const metrics = { total: 5, newCount: 2, needsFollowUp: 1, dueToday: 1, converted: 1 };
    mockMetrics.mockResolvedValue(metrics);
    await expect(service.getMetrics()).resolves.toEqual(metrics);
  });
});

describe("PlatformLeadsService.updateLead", () => {
  const service = new PlatformLeadsService();
  beforeEach(() => jest.clearAllMocks());

  it("parses a status + follow-up date and forwards a Date to the repo (audited actor)", async () => {
    mockUpdate.mockResolvedValue(row({ status: "FOLLOW_UP", nextFollowUpAt: new Date("2026-10-01T00:00:00.000Z") }));
    await service.updateLead("lead-1", "admin-9", {
      status: "FOLLOW_UP",
      nextFollowUpAt: "2026-10-01T00:00:00.000Z",
    });
    const arg = mockUpdate.mock.calls[0][0];
    expect(arg.id).toBe("lead-1");
    expect(arg.actorUserId).toBe("admin-9");
    expect(arg.status).toBe("FOLLOW_UP");
    expect(arg.nextFollowUpAt).toBeInstanceOf(Date);
    expect((arg.nextFollowUpAt as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("supports clearing the follow-up date (null) and marking contact now", async () => {
    mockUpdate.mockResolvedValue(row({ lastContactAt: new Date() }));
    await service.updateLead("lead-1", "admin-9", { nextFollowUpAt: null, markContactedNow: true });
    const arg = mockUpdate.mock.calls[0][0];
    expect(arg.nextFollowUpAt).toBeNull();
    expect(arg.markContactedNow).toBe(true);
  });

  it("rejects an empty (no-change) body with a validation error and never calls the repo", async () => {
    await expect(service.updateLead("lead-1", "admin-9", {})).rejects.toBeInstanceOf(ValidationApiException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown status", async () => {
    await expect(service.updateLead("lead-1", "admin-9", { status: "WON" })).rejects.toBeInstanceOf(ValidationApiException);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("maps a missing lead to a 404", async () => {
    mockUpdate.mockResolvedValue(null);
    await expect(service.updateLead("missing", "admin-9", { status: "CONTACTED" })).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
