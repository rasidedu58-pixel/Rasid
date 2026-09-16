import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextSessionCard, type NextSessionInfo } from "../app/(app)/dashboard/next-session-card";
import { qk } from "../lib/query-keys";

/**
 * Component-level regression for the automatic time transitions the
 * owner directed (Phase 9): once the current session's window ends, the
 * card must transition WITHOUT a manual refresh — the boundary-scheduled
 * `invalidateQueries` fires, React Query refetches `/action-center`, and
 * the panel then reflects the fresh server truth.
 *
 * Vitest fake timers drive both `setTimeout` (the scheduler) AND
 * `Date.now` (the internal "now" tick), so the exact `scheduledAt +
 * durationMinutes` instant can be reached deterministically without a
 * real clock. React Query is configured with no retries + zero
 * `staleTime` so an invalidation triggers a synchronous refetch cycle
 * from the mocked fetcher.
 */

// The card reads `useWorkspace().workspaceId`. Provide a stub so the
// component tree doesn't need the real provider (which does auth work).
vi.mock("../lib/workspace-provider", () => ({
  useWorkspace: () => ({ workspaceId: "ws-1", isOwner: true }),
}));

// jsdom lacks matchMedia; the card doesn't use it, but sibling primitives
// occasionally do — mirror the pattern used by the other component tests.
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
  vi.useRealTimers();
  vi.resetAllMocks();
});

// A deterministic clock anchor: Wednesday 2026-09-16 18:00 UTC.
const NOW = new Date("2026-09-16T18:00:00Z").getTime();

function live60(): NextSessionInfo {
  // A live IN_PROGRESS session that started 15 min ago, still 45 min in
  // its window as of `NOW`. Boundary (end) = NOW + 45 min.
  return {
    id: "s-live",
    groupName: "الرياضيات",
    scheduledAt: new Date(NOW - 15 * 60_000).toISOString(),
    durationMinutes: 60,
    status: "IN_PROGRESS",
  };
}

function renderCard(session: NextSessionInfo | null | undefined, opts: { workspaceIdKey?: string } = {}) {
  const workspaceIdKey = opts.workspaceIdKey ?? "ws-1";
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  // Seed the action-center cache so the card's effect has a real query
  // key to invalidate. The mocked fetcher replays whatever we return.
  queryClient.setQueryData(qk.actionCenter.root(workspaceIdKey), { nextSession: session, asOf: new Date(NOW).toISOString() });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <NextSessionCard session={session} />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe("NextSessionCard — automatic transition at window end", () => {
  it("hides the live 'جارية الآن' pill the exact instant the slot ends, without a user refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
    const session = live60();

    renderCard(session);
    // Initial paint (synchronous — the card reads Date.now() once and
    // renders immediately from the seeded query data): «الحصة الجارية الآن».
    expect(screen.getByLabelText("الحصة الجارية الآن")).toBeTruthy();

    // Advance to exactly the session's end (`start + duration`). At the
    // exact boundary, `isStillLive` becomes false — the card must swap
    // to the calm defensive state, NOT keep claiming the class is live.
    const endMs = new Date(session.scheduledAt).getTime() + session.durationMinutes! * 60_000;
    await act(async () => {
      vi.setSystemTime(endMs);
      // Move the useNow tick + fire any queued setTimeouts up through end.
      vi.advanceTimersByTime(endMs - NOW + 1000);
    });

    // The live label MUST be gone; the defensive "تحديث اللوحة…" copy
    // is showing instead. This is the transition WITHOUT a refresh.
    expect(screen.queryByLabelText("الحصة الجارية الآن")).toBeNull();
    expect(screen.getByText(/تحديث اللوحة/)).toBeTruthy();
  });

  it("schedules and fires exactly ONE queryClient invalidation at the boundary — no polling, no duplicate timers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
    const session = live60();
    const { queryClient } = renderCard(session);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const endMs = new Date(session.scheduledAt).getTime() + session.durationMinutes! * 60_000;
    await act(async () => {
      vi.setSystemTime(endMs);
      vi.advanceTimersByTime(endMs - NOW + 300);
    });

    // Called for the action-center query key, exactly once at boundary.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.actionCenter.root("ws-1") });
    // Advancing another hour must not schedule ANOTHER invalidation —
    // the boundary is a one-shot per session.
    await act(async () => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("clears the pending boundary timer on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
    const session = live60();
    const { unmount, queryClient } = renderCard(session);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    unmount();

    // Advance past the boundary; a leaked timer would fire the
    // invalidation here. Nothing should call it.
    const endMs = new Date(session.scheduledAt).getTime() + session.durationMinutes! * 60_000;
    await act(async () => {
      vi.setSystemTime(endMs);
      vi.advanceTimersByTime(endMs - NOW + 300);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("cleans up and reschedules when the workspace-scoped session changes (no duplicate timer, no stale boundary)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
    const first = live60();
    const { rerender, queryClient } = renderCard(first);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    // Swap in a different session with a LATER end (2h out). The
    // previous timer must be cleared, and the new one scheduled at the
    // new session's boundary — no orphaned firing.
    const second: NextSessionInfo = {
      ...first,
      id: "s-live-2",
      scheduledAt: new Date(NOW - 5 * 60_000).toISOString(),
      durationMinutes: 120,
    };
    rerender(
      <QueryClientProvider client={queryClient}>
        <NextSessionCard session={second} />
      </QueryClientProvider>,
    );

    // Advance to the FIRST session's would-be boundary → nothing should fire.
    const firstEnd = new Date(first.scheduledAt).getTime() + first.durationMinutes! * 60_000;
    await act(async () => {
      vi.setSystemTime(firstEnd);
      vi.advanceTimersByTime(firstEnd - NOW + 300);
    });
    expect(spy).not.toHaveBeenCalled();

    // Advance to the SECOND session's boundary → invalidation fires once.
    const secondEnd = new Date(second.scheduledAt).getTime() + second.durationMinutes! * 60_000;
    await act(async () => {
      vi.setSystemTime(secondEnd);
      vi.advanceTimersByTime(secondEnd - firstEnd + 300);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("skips scheduling entirely when the server did not supply durationMinutes (rolling-deploy compat)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(NOW);
    // An old API build that hasn't rolled out yet: no durationMinutes.
    const legacyShape: NextSessionInfo = {
      id: "s-live",
      groupName: "الرياضيات",
      scheduledAt: new Date(NOW - 15 * 60_000).toISOString(),
      status: "IN_PROGRESS",
      // durationMinutes deliberately omitted
    };
    const { queryClient } = renderCard(legacyShape);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    // Advance far into the future — nothing should fire (no boundary
    // can be computed without duration, and NO fabricated fallback is
    // used).
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 60_000);
    });
    expect(spy).not.toHaveBeenCalled();
    // The card must ALSO NOT fall into the defensive "تحديث اللوحة…"
    // state here — without duration it cannot know the window has
    // ended, so it stays in its live rendering (the server remains
    // source of truth on the next refetch).
    expect(screen.queryByText(/تحديث اللوحة/)).toBeNull();
  });
});
