import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";

const fetchDashboardMock = vi.fn();

vi.mock("../lib/api/platform-admin", () => ({
  fetchPlatformAdminDashboard: () => fetchDashboardMock(),
  // The command center also loads these; default them so only the dashboard
  // query drives the auth gate under test.
  fetchPlatformNeedsAttention: () => Promise.resolve({ trialsExpiringSoon: [], expired: [], paymentFailed: [] }),
  fetchPlatformActivity: () => Promise.resolve({ items: [], available: true }),
  fetchPlatformAdminWorkspaces: () => Promise.resolve({ items: [], page: { hasNext: false, nextCursor: null } }),
  fetchPlatformAdminUsers: () => Promise.resolve({ items: [], page: { hasNext: false, nextCursor: null } }),
}));

vi.mock("../lib/api/health", () => ({
  fetchApiHealth: () => Promise.resolve({ api: "up", database: "up" }),
}));

afterEach(() => {
  cleanup();
  fetchDashboardMock.mockReset();
});

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return import("../app/platform-admin/page").then(({ default: PlatformAdminDashboardPage }) =>
    render(
      <QueryClientProvider client={queryClient}>
        <PlatformAdminDashboardPage />
      </QueryClientProvider>,
    ),
  );
}

/**
 * Real enforcement is server-side (`PlatformAdminGuard`, see its own spec)
 * — this test proves the FRONTEND'S own responsibility: a workspace Owner
 * (or anyone else not on the platform_admins allowlist) hitting a
 * Platform Admin page must see a clear "no access" state, never a crash
 * or a silent blank page, when the API returns its safe-no-leak 403.
 */
describe("Platform Admin — non-admin rejection (frontend)", () => {
  it("renders PermissionDeniedState, not a crash, when the API returns FORBIDDEN (e.g. a Teacher Workspace Owner)", async () => {
    const { ApiRequestError } = await import("../lib/api/client");
    fetchDashboardMock.mockRejectedValue(new ApiRequestError(403, "FORBIDDEN", "ممنوع"));

    await renderDashboard();

    expect(await screen.findByText("لا تملك صلاحية الوصول لهذا القسم")).toBeTruthy();
  });

  it("renders the real dashboard data for an authorized platform admin", async () => {
    fetchDashboardMock.mockResolvedValue({
      totalUsers: 12,
      totalWorkspaces: 8,
      subscriptionsByState: { TRIAL: 5, ACTIVE: 3 },
      recentSignups: [],
      expiringWithin7Days: 1,
    });

    await renderDashboard();

    expect(await screen.findByText("مركز تشغيل راصد")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });
});
