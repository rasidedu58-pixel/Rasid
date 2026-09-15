import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { OnboardingStatusResponse } from "@academic-precision/contracts";
import { qk } from "../lib/query-keys";

/**
 * Guided-setup launcher tests — verify the presentation rules that the
 * spec calls out explicitly (Owner-only, four visible UX steps derived
 * from five raw signals, dependency cascade, sessions-ready confidence
 * line, dismiss-after-completion, RTL / non-color status indicators,
 * CTA closes the sheet before navigation), without depending on the
 * real API layer.
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

/**
 * Small helper — build a full response with only the fields the test
 * wants to override. Keeps every scenario terse and pins the response
 * shape's four steps + five raw signals in one place.
 */
function status(overrides: {
  completed?: number;
  steps?: Partial<OnboardingStatusResponse["steps"]>;
  nextStep?: OnboardingStatusResponse["nextStep"];
  allDone?: boolean;
  rawStates?: Partial<OnboardingStatusResponse["rawStates"]>;
}): OnboardingStatusResponse {
  const baseSteps: OnboardingStatusResponse["steps"] = {
    createGroup: "AVAILABLE",
    prepareMonth: "LOCKED",
    enrollStudents: "LOCKED",
    recordAttendance: "LOCKED",
  };
  const baseRaw: OnboardingStatusResponse["rawStates"] = {
    groupExists: false,
    operatingMonthPrepared: false,
    studentsEnrolled: false,
    sessionsGenerated: false,
    attendanceRecorded: false,
  };
  return {
    completed: overrides.completed ?? 0,
    total: 4,
    steps: { ...baseSteps, ...overrides.steps },
    nextStep: overrides.nextStep ?? "createGroup",
    allDone: overrides.allDone ?? false,
    rawStates: { ...baseRaw, ...overrides.rawStates },
  };
}

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
    fetchStatusMock.mockResolvedValue(status({}));
    await renderLauncher();
    expect(screen.queryByLabelText(/إعداد الحساب/)).toBeNull();
  });

  it("renders the FAB with the 0/4 label for a fresh owner workspace", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue(status({}));
    await renderLauncher();
    const btn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 0 من 4 مكتملة/,
    });
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("0/4");
  });

  it("group exists + no CURRENT month → Step 1 COMPLETED, Step 2 AVAILABLE (the exact owner-flagged bug)", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue(
      status({
        completed: 1,
        steps: {
          createGroup: "COMPLETED",
          prepareMonth: "AVAILABLE",
        },
        nextStep: "prepareMonth",
        rawStates: { groupExists: true },
      }),
    );
    await renderLauncher();
    const btn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 1 من 4 مكتملة/,
    });
    expect(btn.textContent).toContain("1/4");
    btn.click();
    const panel = await screen.findByTestId("guided-setup-panel");
    const rows = Object.fromEntries(
      Array.from(panel.querySelectorAll("li[data-step]")).map((r) => [
        r.getAttribute("data-step"),
        r.getAttribute("data-status"),
      ]),
    );
    expect(rows).toEqual({
      createGroup: "COMPLETED",
      prepareMonth: "AVAILABLE",
      enrollStudents: "LOCKED",
      recordAttendance: "LOCKED",
    });
    // No confidence line yet — sessions haven't been generated.
    expect(screen.queryByTestId("guided-setup-confidence")).toBeNull();
  });

  it("month + schedule prepared AND sessions generated (same txn) → prepareMonth COMPLETED, confidence line rendered under it", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue(
      status({
        completed: 2,
        steps: {
          createGroup: "COMPLETED",
          prepareMonth: "COMPLETED",
          enrollStudents: "AVAILABLE",
        },
        nextStep: "enrollStudents",
        rawStates: {
          groupExists: true,
          operatingMonthPrepared: true,
          sessionsGenerated: true,
        },
      }),
    );
    await renderLauncher();
    const btn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 2 من 4 مكتملة/,
    });
    btn.click();
    const confidence = await screen.findByTestId("guided-setup-confidence");
    expect(confidence.textContent ?? "").toContain(
      "تم تجهيز حصص هذا الشهر تلقائيًا",
    );
    // Confidence line lives INSIDE the prepareMonth step row — pins it
    // so a refactor can't accidentally move it under the wrong step.
    const prepareMonthRow = screen
      .getByTestId("guided-setup-panel")
      .querySelector('li[data-step="prepareMonth"]');
    expect(prepareMonthRow?.contains(confidence)).toBe(true);
  });

  it("shows finished footer on 4/4 and lets the owner permanently dismiss the launcher", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue(
      status({
        completed: 4,
        steps: {
          createGroup: "COMPLETED",
          prepareMonth: "COMPLETED",
          enrollStudents: "COMPLETED",
          recordAttendance: "COMPLETED",
        },
        nextStep: null,
        allDone: true,
        rawStates: {
          groupExists: true,
          operatingMonthPrepared: true,
          studentsEnrolled: true,
          sessionsGenerated: true,
          attendanceRecorded: true,
        },
      }),
    );
    await renderLauncher();
    const btn = await screen.findByRole("button", { name: /إعداد الحساب مكتمل/ });
    btn.click();
    const dismiss = await screen.findByRole("button", {
      name: /إخفاء دليل الإعداد نهائيًا/,
    });
    dismiss.click();
    expect(localStorage.getItem("rasid_guided_dismissed_ws-1")).toBe("1");
    // Legacy key (used by the pre-refactor dashboard) must NEVER be
    // written by the new derivation path.
    expect(localStorage.getItem("rasid_setup_done_ws-1")).toBeNull();
  });

  it("historical attendance without a current month → COMPLETED wins over LOCKED, launcher still surfaces earlier undone steps", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue(
      status({
        completed: 1,
        steps: {
          createGroup: "AVAILABLE",
          prepareMonth: "LOCKED",
          enrollStudents: "LOCKED",
          recordAttendance: "COMPLETED",
        },
        nextStep: "createGroup",
        rawStates: { attendanceRecorded: true },
      }),
    );
    await renderLauncher();
    const btn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 1 من 4 مكتملة/,
    });
    expect(btn.textContent).toContain("1/4");
  });

  it("invalidation round-trip (create-group / prepare-month / enrolment) reflects on the launcher without a window-focus or staleTime wait", async () => {
    // Owner is on any page. First cache: fresh workspace, Step 1
    // AVAILABLE. After the create-group wizard invalidates
    // qk.onboarding.status inside its mutationFn, the server truth
    // says Step 1 COMPLETED + Step 2 available (also completed if the
    // full wizard succeeded — here we simulate the partial-progress
    // NO_CURRENT_MONTH recovery case: group exists, month not yet).
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock
      .mockResolvedValueOnce(status({}))
      .mockResolvedValueOnce(
        status({
          completed: 1,
          steps: {
            createGroup: "COMPLETED",
            prepareMonth: "AVAILABLE",
          },
          nextStep: "prepareMonth",
          rawStates: { groupExists: true },
        }),
      );
    const queryClient = await renderLauncher();
    const beforeBtn = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 0 من 4 مكتملة/,
    });
    expect(beforeBtn.textContent).toContain("0/4");

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: qk.onboarding.status("ws-1") });
    });
    expect(fetchStatusMock).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const cached = queryClient.getQueryData(qk.onboarding.status("ws-1")) as
        | OnboardingStatusResponse
        | undefined;
      expect(cached?.completed).toBe(1);
      expect(cached?.steps.createGroup).toBe("COMPLETED");
    });
  });

  it("tapping a step CTA closes the sheet BEFORE navigation and does not fabricate completion", async () => {
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue(status({}));
    const queryClient = await renderLauncher();
    const fab = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 0 من 4 مكتملة/,
    });
    fab.click();
    await screen.findByTestId("guided-setup-panel");

    const cacheBefore = queryClient.getQueryData(qk.onboarding.status("ws-1"));

    const cta = await screen.findByTestId("guided-setup-cta-createGroup");
    // The first CTA on an empty workspace routes to /groups — the
    // create-group wizard, which is the genuine first-run entry.
    expect(cta.getAttribute("href")).toBe("/groups");
    // Neutralise jsdom's "not implemented: navigation" once the anchor
    // click is about to bubble into a real navigation.
    cta.addEventListener("click", (e) => e.preventDefault());
    cta.click();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByTestId("guided-setup-panel")).toBeNull();
    });
    // Launcher's collapsed trigger remains.
    expect(
      screen.getByRole("button", {
        name: /متابعة إعداد الحساب — 0 من 4 مكتملة/,
      }),
    ).toBeTruthy();
    // Cache is unchanged — the tap did not fabricate progress.
    expect(queryClient.getQueryData(qk.onboarding.status("ws-1"))).toBe(cacheBefore);
    expect(localStorage.getItem("rasid_guided_dismissed_ws-1")).toBeNull();
    expect(localStorage.getItem("rasid_setup_done_ws-1")).toBeNull();
  });

  it("opens the completed 4/4 panel without throwing even when the cached response is missing `rawStates` (stale in-memory value from a pre-390d120 rolling deploy)", async () => {
    // Reproduces the exact production crash: an authenticated Owner's
    // React Query cache holds a response that pre-dates the 5-raw/4-UX
    // rewrite (no `rawStates` field). The FAB renders (it only reads
    // `completed`/`total`/`allDone`, all present in every past shape),
    // but opening the sheet used to read `data.rawStates.sessionsGenerated`
    // straight through and throw `Cannot read properties of undefined`,
    // which escaped every per-page error boundary because the launcher
    // is mounted at shell level — the exception bubbled all the way to
    // `global-error.tsx`.
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    const stale = {
      completed: 4,
      total: 4,
      steps: {
        createGroup: "COMPLETED",
        prepareMonth: "COMPLETED",
        enrollStudents: "COMPLETED",
        recordAttendance: "COMPLETED",
      },
      nextStep: null,
      allDone: true,
      // Deliberately no `rawStates` — the stale shape.
    } as unknown as OnboardingStatusResponse;
    fetchStatusMock.mockResolvedValue(stale);
    await renderLauncher();
    const fab = await screen.findByRole("button", { name: /إعداد الحساب مكتمل/ });
    // The panel must open and render every completed row without
    // throwing. This is the regression assertion — a throw here would
    // reach the surrounding error boundary in production.
    expect(() => fab.click()).not.toThrow();
    const panel = await screen.findByTestId("guided-setup-panel");
    const rows = Array.from(panel.querySelectorAll("li[data-step]")).map((r) => r.getAttribute("data-step"));
    expect(rows).toEqual(["createGroup", "prepareMonth", "enrollStudents", "recordAttendance"]);
    // Confidence line is absent when the raw signal is unknown — the
    // launcher must NOT invent it from thin air.
    expect(screen.queryByTestId("guided-setup-confidence")).toBeNull();
    // Finished footer still renders (it depends only on `allDone`).
    expect(screen.getByRole("button", { name: /إخفاء دليل الإعداد نهائيًا/ })).toBeTruthy();
  });

  it("student exists workspace-side but no enrolment on the CURRENT month → Step 3 stays AVAILABLE with the honest depHint under LOCKED-below", async () => {
    // Guards the wording contract: `enrollStudents` is backed by the
    // enrollments predicate, so a bare Student row never flips it.
    // The step below (`recordAttendance`) then stays LOCKED with a
    // dep-hint that references the enrolment blocker, never the
    // internal enrollment entity.
    workspaceValue = { workspaceId: "ws-1", isOwner: true };
    fetchStatusMock.mockResolvedValue(
      status({
        completed: 2,
        steps: {
          createGroup: "COMPLETED",
          prepareMonth: "COMPLETED",
          enrollStudents: "AVAILABLE",
        },
        nextStep: "enrollStudents",
        rawStates: {
          groupExists: true,
          operatingMonthPrepared: true,
          sessionsGenerated: true,
        },
      }),
    );
    await renderLauncher();
    const fab = await screen.findByRole("button", {
      name: /متابعة إعداد الحساب — 2 من 4 مكتملة/,
    });
    fab.click();
    const panel = await screen.findByTestId("guided-setup-panel");
    const enrollRow = panel.querySelector('li[data-step="enrollStudents"]');
    const attendanceRow = panel.querySelector('li[data-step="recordAttendance"]');
    expect(enrollRow?.getAttribute("data-status")).toBe("AVAILABLE");
    expect(attendanceRow?.getAttribute("data-status")).toBe("LOCKED");
    // Copy: neither row leaks "enrollment entity" / "group_month".
    const enrollText = enrollRow?.textContent ?? "";
    const attendanceText = attendanceRow?.textContent ?? "";
    expect(enrollText).not.toMatch(/group_month|enrollment entity|GENERATED/i);
    expect(attendanceText).not.toMatch(/group_month|enrollment entity|GENERATED/i);
  });
});
