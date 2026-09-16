import { describe, expect, it } from "vitest";
import { isStillLive, nextBoundaryMs, type NextSessionInfo } from "../app/(app)/dashboard/next-session-card";

/**
 * Boundary math for the Next Session card — proves the state re-derives
 * automatically when `now` crosses `scheduledAt` or `scheduledAt +
 * durationMinutes`, WITHOUT a manual refresh (owner directive, Phase 9).
 *
 * These are the pure inputs of the effect that schedules a one-shot
 * `queryClient.invalidateQueries` at the next transition. If the math is
 * right, the effect wakes up at the correct instant; the card's own
 * defensive fallback (`isStillLive`) also stops calling a session live the
 * moment its window ends.
 */
function scheduled(scheduledAt: string, durationMinutes: number, status: NextSessionInfo["status"]): NextSessionInfo {
  return { id: "s-1", groupName: "الرياضيات", scheduledAt, durationMinutes, status };
}

const START = new Date("2026-09-16T18:00:00Z").getTime();

describe("NextSessionCard — automatic time transitions", () => {
  it("isStillLive — IN_PROGRESS session before its end is live", () => {
    const s = scheduled(new Date(START).toISOString(), 60, "IN_PROGRESS");
    expect(isStillLive(s, START + 30 * 60_000)).toBe(true); // 30 min in
  });

  it("isStillLive — IN_PROGRESS session AT its end is NO longer live (owner: exact boundary, no grace)", () => {
    const s = scheduled(new Date(START).toISOString(), 60, "IN_PROGRESS");
    expect(isStillLive(s, START + 60 * 60_000)).toBe(false); // now === end
  });

  it("isStillLive — IN_PROGRESS session past its end is NO longer live (the exact reproduction: Monday session on Wednesday)", () => {
    const s = scheduled(new Date("2026-09-14T19:19:00Z").toISOString(), 60, "IN_PROGRESS");
    const wednesday = new Date("2026-09-16T12:00:00Z").getTime();
    expect(isStillLive(s, wednesday)).toBe(false);
  });

  it("isStillLive — READY session (slot arrived, not started) is live while its window is open", () => {
    const s = scheduled(new Date(START).toISOString(), 60, "READY");
    expect(isStillLive(s, START + 10 * 60_000)).toBe(true);
  });

  it("isStillLive — SCHEDULED (future) card is always still-live for the purpose of showing the countdown", () => {
    // A future session card must render; the boundary scheduler will
    // refetch when its start hits.
    const s = scheduled(new Date(START).toISOString(), 60, "SCHEDULED");
    expect(isStillLive(s, START - 30 * 60_000)).toBe(true);
  });

  it("nextBoundaryMs — future session: the next boundary is its START", () => {
    const s = scheduled(new Date(START).toISOString(), 60, "SCHEDULED");
    const now = START - 15 * 60_000;
    expect(nextBoundaryMs(s, now)).toBe(START);
  });

  it("nextBoundaryMs — live session: next boundary is the END (start is already past)", () => {
    const s = scheduled(new Date(START).toISOString(), 60, "IN_PROGRESS");
    const now = START + 20 * 60_000;
    expect(nextBoundaryMs(s, now)).toBe(START + 60 * 60_000);
  });

  it("nextBoundaryMs — ended session (should never actually reach the card): Infinity so the scheduler does nothing", () => {
    const s = scheduled(new Date(START).toISOString(), 60, "IN_PROGRESS");
    const now = START + 120 * 60_000;
    expect(nextBoundaryMs(s, now)).toBe(Infinity);
  });

  it("nextBoundaryMs — the SCHEDULED→READY transition: at exactly `start` the boundary is `end`", () => {
    // Exact boundary reproducibility: the scheduler is set to fire at
    // `start + 250ms`. When it fires, `now === start`, and the next
    // boundary must be `end`.
    const s = scheduled(new Date(START).toISOString(), 60, "SCHEDULED");
    expect(nextBoundaryMs(s, START)).toBe(START + 60 * 60_000);
  });
});
