import "reflect-metadata";
import type { PlatformActivityResponse, PlatformAdminDashboardResponse } from "@academic-precision/contracts";
import { redactActivityForRole, redactDashboardForRole, redactWorkspaceSummariesForRole } from "./platform-admin.service";

/**
 * Regression (item 2): a SUPPORT_AGENT (platform.customers.view but NOT
 * platform.subscriptions.view) must never obtain subscription data through the
 * mixed-content read endpoints (dashboard, activity). The dedicated per-customer
 * subscription and the needs-attention feed are separately gated by the
 * permission guard (see platform-permission.guard.spec) — these tests cover the
 * responses that legitimately mix customer + subscription content.
 */

const dashboard: PlatformAdminDashboardResponse = {
  totalUsers: 10,
  totalWorkspaces: 4,
  subscriptionsByState: { TRIAL: 3, ACTIVE: 1 },
  recentSignups: [],
  expiringWithin7Days: 2,
};

const activity: PlatformActivityResponse = {
  available: true,
  items: [
    { kind: "workspace.created", at: "2026-08-01T00:00:00.000Z", workspaceId: "w1", workspaceName: "A", label: "تسجيل جديد", detail: null },
    { kind: "subscription.state_changed", at: "2026-08-02T00:00:00.000Z", workspaceId: "w2", workspaceName: "B", label: "تغيّر الاشتراك", detail: "EXPIRED" },
  ],
};

describe("Subscription-data redaction by role", () => {
  it("strips subscription counts from the dashboard for SUPPORT_AGENT", () => {
    const r = redactDashboardForRole(dashboard, "SUPPORT_AGENT");
    expect(r.subscriptionsByState).toEqual({});
    expect(r.expiringWithin7Days).toBe(0);
    // Non-subscription content is preserved.
    expect(r.totalUsers).toBe(10);
    expect(r.totalWorkspaces).toBe(4);
  });

  it("keeps full dashboard subscription data for OPERATIONS_ADMIN and PLATFORM_OWNER", () => {
    for (const role of ["OPERATIONS_ADMIN", "PLATFORM_OWNER"] as const) {
      const r = redactDashboardForRole(dashboard, role);
      expect(r.subscriptionsByState).toEqual({ TRIAL: 3, ACTIVE: 1 });
      expect(r.expiringWithin7Days).toBe(2);
    }
  });

  it("drops subscription-change activity for SUPPORT_AGENT but keeps signups", () => {
    const r = redactActivityForRole(activity, "SUPPORT_AGENT");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.kind).toBe("workspace.created");
  });

  it("keeps subscription-change activity for OPERATIONS_ADMIN", () => {
    const r = redactActivityForRole(activity, "OPERATIONS_ADMIN");
    expect(r.items).toHaveLength(2);
  });

  it("redacts when role is null (defensive)", () => {
    expect(redactDashboardForRole(dashboard, null).subscriptionsByState).toEqual({});
    expect(redactActivityForRole(activity, null).items).toHaveLength(1);
  });

  it("nulls per-workspace subscriptionState in the workspaces list for SUPPORT_AGENT (alternate route)", () => {
    const items = [
      { id: "w1", subscriptionState: "ACTIVE" },
      { id: "w2", subscriptionState: "EXPIRED" },
    ];
    expect(redactWorkspaceSummariesForRole(items, "SUPPORT_AGENT").map((i) => i.subscriptionState)).toEqual([null, null]);
    expect(redactWorkspaceSummariesForRole(items, "OPERATIONS_ADMIN").map((i) => i.subscriptionState)).toEqual(["ACTIVE", "EXPIRED"]);
  });
});
