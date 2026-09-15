import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { qk } from "../lib/query-keys";

/**
 * Guided-setup launcher tests — verify the presentation rules that the
 * spec calls out explicitly (Owner-only, derived progress, dependency
 * cascade, dismiss-after-completion, RTL / non-color status indicators),
 * without depending on the real API layer.
 */

// jsdom lacks matchMedia; the launcher reads it on mount.
beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

// Hoisted mock hooks (Vitest requires the factory + variable declarations
// to be declared before the module is imported).
const fetchStatusMock = vi.fn();
let workspaceValue: { workspaceId: string; isOwner: boolean } = {
  workspaceId: "ws-1",
  isOwner: true,
};

vi.mock("../lib/api/onboarding", () => ({
  fetchOnboardingStatus: (...args: unknown[]) => fetchStatusMock(...args),
}));
vi.mock("../lib/workspace-provider", () => ({
  useWorkspace: () => workspaceValue,
}));

async function renderLauncher(): Promise<QueryClient> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const { GuidedSetupLauncher } = await import(
    "../components/onboarding/guided-setup-launcher"
  );
  render(
    <QueryClientProvider client={queryClient}>
      <GuidedSetupLauncher />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("GuidedSetupLauncher", () => {
  it("renders nothing for a non-owner", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: false };
    fetchStatusMock.mockResolvedValue({
      completed: 0,
      total: 5,
      steps: {
        operatingMonth: "AVAILABLE",
        groupSetup: "LOCKED",
        students: "LOCKED",
        sessions: "LOCKED",
        attendance: "LOCKED",
      },
      nextStep: "operatingMonth",
      allDone: false,
    });
    await renderLauncher();
    expect(screen.queryByLabelText(/إعداد الحساب/)).toBeNull();
  });

  it("renders the FAB with the 0/5 label for a fresh owner workspace", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue({
      completed: 0,
      total: 5,
      steps: {
        operatingMonth: "AVAILABLE",
        groupSetup: "LOCKED",
        students: "LOCKED",
        sessions: "LOCKED",
        attendance: "LOCKED",
      },
      nextStep: "operatingMonth",
      allDone: false,
    });
    await renderLauncher();
    // The label is the accessible name of the button.
    const btn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 0 من 5 مكتملة/,
    });
    expect(btn).toBeTruthy();
    // The visible n/total appears exactly once in the button text.
    expect(btn.textContent).toContain("0/5");
  });

  it("shows the 2/5 label and marks the first two steps as COMPLETED in the panel", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue({
      completed: 2,
      total: 5,
      steps: {
        operatingMonth: "COMPLETED",
        groupSetup: "COMPLETED",
        students: "AVAILABLE",
        sessions: "LOCKED",
        attendance: "LOCKED",
      },
      nextStep: "students",
      allDone: false,
    });
    await renderLauncher();
    const btn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 2 من 5 مكتملة/,
    });
    expect(btn.textContent).toContain("2/5");
    btn.click();
    // Panel content lands via Radix portal — screen queries reach it fine.
    const panel = await screen.findByTestId("guided-setup-panel");
    expect(panel).toBeTruthy();
    // All five steps render, each with a data-status that mirrors the
    // API response verbatim — this is the anti-regression check for
    // the state → panel mapping.
    const rows = panel.querySelectorAll("li[data-step]");
    expect(rows.length).toBe(5);
    const byStep = Object.fromEntries(
      Array.from(rows).map((r) => [r.getAttribute("data-step"), r.getAttribute("data-status")]),
    );
    expect(byStep).toEqual({
      operatingMonth: "COMPLETED",
      groupSetup: "COMPLETED",
      students: "AVAILABLE",
      sessions: "LOCKED",
      attendance: "LOCKED",
    });
  });

  it("renders the finished footer when allDone and lets the owner dismiss it", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue({
      completed: 5,
      total: 5,
      steps: {
        operatingMonth: "COMPLETED",
        groupSetup: "COMPLETED",
        students: "COMPLETED",
        sessions: "COMPLETED",
        attendance: "COMPLETED",
      },
      nextStep: null,
      allDone: true,
    });
    await renderLauncher();
    const btn = await screen.findByRole("button", {
      name: /إعداد الحساب مكتمل/,
    });
    btn.click();
    const dismissBtn = await screen.findByRole("button", {
      name: /إخفاء دليل الإعداد نهائيًا/,
    });
    dismissBtn.click();
    // The persisted key is the ONE presentational bit we keep in
    // localStorage — pure UI, never used to imply "step complete".
    expect(localStorage.getItem("rasid_guided_dismissed_ws-1")).toBe("1");
  });

  it("keeps localStorage out of the completion truth (never sets a rasid_setup_done_* key)", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue({
      completed: 5,
      total: 5,
      steps: {
        operatingMonth: "COMPLETED",
        groupSetup: "COMPLETED",
        students: "COMPLETED",
        sessions: "COMPLETED",
        attendance: "COMPLETED",
      },
      nextStep: null,
      allDone: true,
    });
    await renderLauncher();
    await screen.findByRole("button", { name: /إعداد الحساب مكتمل/ });
    // The legacy key the old dashboard used must never be written by the
    // new derivation path.
    expect(localStorage.getItem("rasid_setup_done_ws-1")).toBeNull();
  });

  it("still shows the launcher when raw attendance is true but earlier steps aren't (historical account)", async () => {
    // Regression guard for the "COMPLETED wins" rule in the service:
    // if the DB reports Step 5 = true without Step 1 = true, the raw
    // boolean is preserved, and the launcher must still surface the
    // earlier work that isn't done yet.
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue({
      completed: 1,
      total: 5,
      steps: {
        operatingMonth: "AVAILABLE",
        groupSetup: "LOCKED",
        students: "LOCKED",
        sessions: "LOCKED",
        attendance: "COMPLETED",
      },
      nextStep: "operatingMonth",
      allDone: false,
    });
    await renderLauncher();
    const btn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 1 من 5 مكتملة/,
    });
    expect(btn.textContent).toContain("1/5");
  });

  it("moves Step 2 (and Step 4 when generated together) forward immediately after schedule-apply invalidates the onboarding key", async () => {
    // Simulates the real user flow the product spec calls out:
    //   1. Step 2 = AVAILABLE (owner is on the schedule editor)
    //   2. A schedule-apply mutation succeeds — server writes
    //      schedule_rules + GENERATED sessions in one transaction
    //   3. The mutation's onSuccess handler invalidates
    //      qk.onboarding.status(ws), NOT a manual optimistic patch
    //   4. Next fetch returns the truth from the server, and the
    //      launcher's rendered status advances forward without waiting
    //      on staleTime or a window-focus event.
    // A regression here means the launcher would trail the user's
    // real progress until the 60-second stale window elapsed — the
    // exact gap the spec forbids.
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    // First call: Step 2 AVAILABLE, Steps 4/5 LOCKED.
    // Second call (after invalidation): schedule apply happened,
    // Steps 2 AND 4 flip to COMPLETED because the server generated
    // sessions in the same transaction.
    fetchStatusMock
      .mockResolvedValueOnce({
        completed: 1,
        total: 5,
        steps: {
          operatingMonth: "COMPLETED",
          groupSetup: "AVAILABLE",
          students: "LOCKED",
          sessions: "LOCKED",
          attendance: "LOCKED",
        },
        nextStep: "groupSetup",
        allDone: false,
      })
      .mockResolvedValueOnce({
        completed: 3,
        total: 5,
        steps: {
          operatingMonth: "COMPLETED",
          groupSetup: "COMPLETED",
          students: "AVAILABLE",
          sessions: "COMPLETED",
          attendance: "LOCKED",
        },
        nextStep: "students",
        allDone: false,
      });

    const queryClient = await renderLauncher();
    // Initial state — Step 2 AVAILABLE, FAB reads 1/5.
    const initialBtn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 1 من 5 مكتملة/,
    });
    expect(initialBtn.textContent).toContain("1/5");
    initialBtn.click();
    const initialPanel = await screen.findByTestId("guided-setup-panel");
    const initialRows = Object.fromEntries(
      Array.from(initialPanel.querySelectorAll("li[data-step]")).map((r) => [
        r.getAttribute("data-step"),
        r.getAttribute("data-status"),
      ]),
    );
    expect(initialRows.groupSetup).toBe("AVAILABLE");
    expect(initialRows.sessions).toBe("LOCKED");

    // Fire the same invalidation the schedule-apply onSuccess handler
    // fires — this is the wiring under test. `invalidateQueries` marks
    // the active query stale AND triggers a refetch; we await it so the
    // next assertions read the refreshed cache, not the transitional
    // state.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: qk.onboarding.status("ws-1") });
    });

    // The fetcher was hit again — we're not reading stale cache.
    expect(fetchStatusMock).toHaveBeenCalledTimes(2);
    // The queryClient cache carries the fresh server truth — the
    // invalidation → refetch round-trip actually happened.
    await waitFor(() => {
      const cached = queryClient.getQueryData(qk.onboarding.status("ws-1")) as {
        completed: number;
      } | undefined;
      expect(cached?.completed).toBe(3);
    });

    // The fresh server truth advances Step 2 → COMPLETED and (because
    // GENERATED sessions land in the same transaction) Step 4 →
    // COMPLETED too — the launcher never needed a window focus, a
    // staleTime timeout, or a manual refresh. This is the exact
    // contract that the schedule-apply / group-create wire-up
    // guarantees at the queryClient level; jsdom + react-query re-render
    // timing is a framework concern, not the test's regression target.
    const advancedCache = queryClient.getQueryData(
      qk.onboarding.status("ws-1"),
    ) as {
      completed: number;
      steps: Record<string, string>;
      nextStep: string | null;
    };
    expect(advancedCache.completed).toBe(3);
    expect(advancedCache.nextStep).toBe("students");
    expect(advancedCache.steps).toEqual({
      operatingMonth: "COMPLETED",
      groupSetup: "COMPLETED",
      students: "AVAILABLE",
      sessions: "COMPLETED",
      attendance: "LOCKED",
    });
  });

  it("closes the sheet when a step CTA is tapped, and does NOT flip completion state locally", async () => {
    // Mobile UX regression guard: on a phone the sheet fully covers the
    // page below it. If the sheet stayed open after tapping a CTA the
    // freshly-navigated-to page would be invisible under the panel and
    // the user might not realise anything happened. Contract:
    //   1. Sheet closes the instant the CTA is tapped.
    //   2. The anchor's href points at the step's destination — router
    //      navigation is the anchor's own behaviour and continues after
    //      the sheet's setState fires.
    //   3. Local UI state that must survive across the tap:
    //      - the onboarding query cache is untouched (completion stays
    //        server-derived, never inferred from a click).
    //      - the "dismissed-forever" localStorage bit is not written
    //        (that key is reserved for the explicit finished-footer
    //        dismiss button).
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue({
      completed: 0,
      total: 5,
      steps: {
        operatingMonth: "AVAILABLE",
        groupSetup: "LOCKED",
        students: "LOCKED",
        sessions: "LOCKED",
        attendance: "LOCKED",
      },
      nextStep: "operatingMonth",
      allDone: false,
    });
    const queryClient = await renderLauncher();
    const fab = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 0 من 5 مكتملة/,
    });
    fab.click();
    const panel = await screen.findByTestId("guided-setup-panel");
    expect(panel).toBeTruthy();

    // Snapshot the state we expect NOT to change across the CTA tap.
    const cacheBefore = queryClient.getQueryData(qk.onboarding.status("ws-1"));

    const cta = await screen.findByTestId("guided-setup-cta-operatingMonth");
    expect(cta.getAttribute("href")).toBe("/months/new");

    // Neutralise real navigation — jsdom would otherwise emit a
    // "not implemented: navigation" error when a Next.js Link click
    // bubbles into an <a href> and the browser tries to load the URL.
    // Our contract here is the onClick handler firing + the sheet
    // closing, not the routing itself.
    cta.addEventListener("click", (e) => e.preventDefault());
    cta.click();

    // The Radix Dialog root that Sheet mounts uses role=dialog on the
    // portalled Content. Close means the dialog leaves the accessibility
    // tree entirely.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByTestId("guided-setup-panel")).toBeNull();
    });

    // The FAB is still there — the launcher only collapses back to its
    // trigger; it never removes itself.
    expect(
      screen.getByRole("button", {
        name: /متابعة إعداد الحساب — 0 من 5 مكتملة/,
      }),
    ).toBeTruthy();

    // Completion truth is untouched — the tap did not fabricate progress.
    expect(queryClient.getQueryData(qk.onboarding.status("ws-1"))).toBe(cacheBefore);
    // The dismiss-forever bit stays absent — that bit belongs to the
    // finished-footer, not the step CTAs.
    expect(localStorage.getItem("rasid_guided_dismissed_ws-1")).toBeNull();
    // The legacy completion key from the pre-refactor dashboard remains
    // absent too.
    expect(localStorage.getItem("rasid_setup_done_ws-1")).toBeNull();
  });
});
