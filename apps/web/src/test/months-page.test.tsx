import { describe, expect, it, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, cleanup } from "@testing-library/react";

const fetchMonthsMock = vi.fn();

vi.mock("../lib/api/scheduling", () => ({
  fetchMonths: (...args: unknown[]) => fetchMonthsMock(...args),
}));

let workspaceValue: { workspaceId: string; isOwner: boolean } = { workspaceId: "ws-1", isOwner: true };
vi.mock("../lib/workspace-provider", () => ({
  useWorkspace: () => workspaceValue,
}));

afterEach(() => {
  cleanup();
  fetchMonthsMock.mockReset();
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return import("../app/(app)/months/page").then(({ default: MonthsPage }) =>
    render(
      <QueryClientProvider client={queryClient}>
        <MonthsPage />
      </QueryClientProvider>,
    ),
  );
}

describe("MonthsPage", () => {
  it("shows a clear no-month empty state with a CTA for the Owner of a fresh workspace", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchMonthsMock.mockResolvedValue({ months: [] });

    await renderPage();

    expect(await screen.findByText("لا يوجد شهر تشغيلي بعد")).toBeTruthy();
    expect(screen.getAllByText("تجهيز أول شهر تشغيلي").length).toBeGreaterThan(0);
  });

  it("hides the creation CTA for a non-owner and shows a waiting message instead", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: false };
    fetchMonthsMock.mockResolvedValue({ months: [] });

    await renderPage();

    expect(await screen.findByText("بانتظار مالك المساحة لتجهيز أول شهر تشغيلي.")).toBeTruthy();
    expect(screen.queryByText("تجهيز أول شهر تشغيلي")).toBeNull();
  });

  it("shows the CURRENT month as a distinct card once one exists", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchMonthsMock.mockResolvedValue({ months: [{ id: "m-1", year: 2026, month: 8, status: "CURRENT", version: 1 }] });

    await renderPage();

    expect(await screen.findByText("حالي")).toBeTruthy();
    expect(screen.getByText("شهر جديد")).toBeTruthy();
  });
});
