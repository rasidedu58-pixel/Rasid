/**
 * Phase 10 — failure testing: worker outage LONGER than the subscription
 * reminder window (7d/3d/1d), plus its Closure Delta resolution.
 *
 * Pure unit tests (no live DB) against the two decision functions
 * `scanSubscriptionReminders` actually calls.
 *
 * History (kept for context, not hypothetical): the original Phase 10 pass
 * measured and documented that `matchesReminderWindow`'s ±12h window means
 * an outage spanning an ENTIRE window (>24h) permanently skips that one
 * milestone, with no backfill — and flagged the product decision of
 * whether that was acceptable. The Phase 10 Closure Delta resolved it:
 * "missing a reminder permanently... is not acceptable" — implement a
 * deterministic catch-up without a heavy scheduling system. That is
 * `determineMilestoneToEmit`, which now backs the actual scan (see
 * `notifications-scan.ts`'s own doc comment for the full rule and why it
 * needs no separate "outage" code path — a normal on-time scan and a
 * catch-up-after-outage scan are literally the same decision).
 * `matchesReminderWindow` itself is kept (still correct on its own terms,
 * still covered) but is no longer what the scan uses to decide.
 */
import { describe, expect, it } from "vitest";
import { matchesReminderWindow, determineMilestoneToEmit } from "./notifications-scan";

describe("matchesReminderWindow (kept, no longer the scan's own decision function)", () => {
  it("an outage shorter than the window (worker resumes 6h late) still matches the 7d point", () => {
    expect(matchesReminderWindow(7 * 24 - 6, 7)).toBe(true);
  });

  it("an outage of exactly the half-width boundary (12h late) still matches — inclusive boundary", () => {
    expect(matchesReminderWindow(7 * 24 - 12, 7)).toBe(true);
  });

  it("an outage longer than the window (13h past the boundary) no longer matches THIS window", () => {
    expect(matchesReminderWindow(7 * 24 - 13, 7)).toBe(false);
    expect(matchesReminderWindow(7 * 24 - 13, 3)).toBe(false);
    expect(matchesReminderWindow(7 * 24 - 13, 1)).toBe(false);
  });
});

describe("determineMilestoneToEmit — Phase 10 Closure Delta catch-up rule", () => {
  const NONE_EMITTED = new Set<string>();

  it("normal, on-time case: nothing crossed yet (>7 days out) — no milestone", () => {
    expect(determineMilestoneToEmit(7 * 24 + 5, NONE_EMITTED)).toBeNull();
  });

  it("normal, on-time case: exactly at the 7d point, nothing emitted yet — emits 7d", () => {
    const result = determineMilestoneToEmit(7 * 24 - 0.1, NONE_EMITTED);
    expect(result?.dedupKey).toBe("7d");
  });

  it("normal case: 7d already emitted, still within the 7d..3d range — emits nothing (not due again)", () => {
    const result = determineMilestoneToEmit(7 * 24 - 5, new Set(["7d"]));
    expect(result).toBeNull();
  });

  it("Example from the correction: worker stops at 8 days remaining, comes back at 5 days -> issues the missed 7d reminder once", () => {
    const hoursUntilExpiry = 5 * 24;
    const result = determineMilestoneToEmit(hoursUntilExpiry, NONE_EMITTED);
    expect(result?.dedupKey).toBe("7d");
  });

  it("Example from the correction: worker comes back at 2 days -> emits 3d, NOT 7d+3d together (never simultaneous stale warnings)", () => {
    const hoursUntilExpiry = 2 * 24;
    const result = determineMilestoneToEmit(hoursUntilExpiry, NONE_EMITTED);
    expect(result?.dedupKey).toBe("3d");
  });

  it("Example from the correction: worker comes back at 12h -> emits 1d (the last, most urgent, still-relevant milestone)", () => {
    const hoursUntilExpiry = 12;
    const result = determineMilestoneToEmit(hoursUntilExpiry, NONE_EMITTED);
    expect(result?.dedupKey).toBe("1d");
  });

  it("never falls back to an older, already-skipped milestone once a more urgent one has already fired", () => {
    // 1d already emitted (e.g. from a previous scan during/after the outage).
    // A later scan, still deep past the 7d/3d points, must NOT retroactively
    // emit the never-sent 3d or 7d reminders just because they're unemitted —
    // "1d" is still the most-recent/most-relevant crossed milestone, and it's
    // already been sent, so nothing further happens.
    const hoursUntilExpiry = 6; // still within the 1d-crossed range
    const result = determineMilestoneToEmit(hoursUntilExpiry, new Set(["1d"]));
    expect(result).toBeNull();
  });

  it("DB dedup remains authoritative: re-asking for a milestone already emitted returns null even mid-outage-catch-up", () => {
    const hoursUntilExpiry = 2 * 24; // would normally resolve to "3d"
    const result = determineMilestoneToEmit(hoursUntilExpiry, new Set(["3d"]));
    expect(result).toBeNull();
  });

  it("progresses correctly across a sequence of scans with no outage: 7d then 3d then 1d, one at a time, in order", () => {
    const emitted = new Set<string>();

    let result = determineMilestoneToEmit(7 * 24 - 1, emitted);
    expect(result?.dedupKey).toBe("7d");
    emitted.add(result!.dedupKey);

    // Still within the 7d..3d range — nothing new.
    expect(determineMilestoneToEmit(7 * 24 - 10, emitted)).toBeNull();

    result = determineMilestoneToEmit(3 * 24 - 1, emitted);
    expect(result?.dedupKey).toBe("3d");
    emitted.add(result!.dedupKey);

    expect(determineMilestoneToEmit(3 * 24 - 10, emitted)).toBeNull();

    result = determineMilestoneToEmit(1 * 24 - 1, emitted);
    expect(result?.dedupKey).toBe("1d");
    emitted.add(result!.dedupKey);

    // After 1d has fired, nothing further — including right up to expiry.
    expect(determineMilestoneToEmit(0.5, emitted)).toBeNull();
  });

  it("does NOT send obsolete reminders once the subscription has already fully expired (hoursUntilExpiry < 0)", () => {
    expect(determineMilestoneToEmit(-1, NONE_EMITTED)).toBeNull();
    expect(determineMilestoneToEmit(-100, new Set(["1d"]))).toBeNull();
  });

  it("an outage spanning multiple milestones (7d AND 3d both crossed, neither emitted) emits only the more urgent 3d, never both", () => {
    const hoursUntilExpiry = 2 * 24; // both 7d and 3d already crossed
    const result = determineMilestoneToEmit(hoursUntilExpiry, NONE_EMITTED);
    expect(result?.dedupKey).toBe("3d");
    // Confirm this is a single-value result, not a list — the type itself
    // makes "emit both" structurally impossible, not just untested.
    expect(Object.keys(result!)).toEqual(["dedupKey", "days"]);
  });
});
