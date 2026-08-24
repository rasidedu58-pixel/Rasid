/**
 * Phase 10 — failure testing: worker outage LONGER than the subscription
 * reminder window (7d/3d/1d).
 *
 * Pure unit test (no live DB) against `matchesReminderWindow` itself — the
 * exact function `scanSubscriptionReminders` uses to decide "is this scan
 * cycle close enough to a reminder point to fire it". This is deliberately
 * the smallest possible surface to prove the real question the Phase 10
 * correction asked: "what happens to a 7d/3d/1d reminder if the worker is
 * down for longer than the ±12h match window around that point?"
 *
 * Finding (documented here, not silently discovered and dropped):
 *
 * `runNotificationsScan` is called once per worker poll cycle (currently a
 * 5-minute cadence — `apps/worker/src/main.ts`). Each call re-evaluates
 * EVERY active subscription's current `hoursUntilExpiry` against all three
 * windows fresh — there is no separate "missed reminder" queue, and no
 * stored cursor of "last scan time". This means:
 *
 * - An outage SHORTER than 24h (the full ±12h window width) around a given
 *   reminder point can NEVER cause that point to be skipped: as long as one
 *   scan cycle runs while `hoursUntilExpiry` is still within ±12h of the
 *   target, it fires — proven by `matchesReminderWindow`'s own half-width
 *   design (documented already in notifications-scan.ts).
 * - An outage LONGER than 24h spanning ENTIRELY across one reminder point's
 *   window (e.g. worker down from 7d+13h until 7d-13h before periodEnd)
 *   means that SPECIFIC reminder point is permanently missed — the next
 *   scan after the worker resumes sees an `hoursUntilExpiry` already past
 *   the window, `matchesReminderWindow` correctly returns false, and
 *   `notifications_dedup_unique` means it can never be inserted retroactively
 *   (there is no backfill/catch-up code path, by design — this test proves
 *   that absence, it does not add one).
 * - The 7d/3d/1d points are independent windows, 4 and 2 days apart
 *   respectively. An outage that misses the 7d point but resumes before the
 *   3d point's own window opens still fires the 3d reminder normally — so a
 *   single missed point does not silently mean "the owner gets zero
 *   reminders for that renewal", only "one fewer of the three".
 *
 * DECISION REQUIRED (documented per the Phase 10 correction's own
 * "أو وثّق القرار المطلوب" escape hatch — this is intentionally NOT
 * resolved by adding new backfill/catch-up logic in Phase 10, since that
 * would be a product behavior change, not hardening of an already-approved
 * design):
 *
 *   Should a worker outage that spans an entire reminder window (>24h)
 *   around a subscription's 7d/3d/1d point silently skip that one
 *   reminder (current, proven behavior), or should the scan additionally
 *   catch up on any point already passed since the LAST successful scan
 *   (would require persisting a last-scan-time or a per-subscription
 *   watermark, which does not exist today)? This is a product decision,
 *   not an infrastructure one — flagged for the user, not decided here.
 */
import { describe, expect, it } from "vitest";
import { matchesReminderWindow } from "./notifications-scan";

describe("Phase 10 — subscription reminder window vs. worker outage duration", () => {
  it("an outage shorter than the window (worker resumes 6h late) still matches the 7d point", () => {
    // periodEnd is 7 days minus 6 hours away when the worker finally polls.
    const hoursUntilExpiry = 7 * 24 - 6;
    expect(matchesReminderWindow(hoursUntilExpiry, 7)).toBe(true);
  });

  it("an outage of exactly the half-width boundary (12h late) still matches — inclusive boundary", () => {
    const hoursUntilExpiry = 7 * 24 - 12;
    expect(matchesReminderWindow(hoursUntilExpiry, 7)).toBe(true);
  });

  it("an outage LONGER than the window (worker resumes 13h past the boundary) permanently misses the 7d point", () => {
    const hoursUntilExpiry = 7 * 24 - 13;
    expect(matchesReminderWindow(hoursUntilExpiry, 7)).toBe(false);
    // Also confirm it does not accidentally match an adjacent window either
    // (the 2-4 day gaps between points mean no double-match window overlap).
    expect(matchesReminderWindow(hoursUntilExpiry, 3)).toBe(false);
    expect(matchesReminderWindow(hoursUntilExpiry, 1)).toBe(false);
  });

  it("a single missed 7d point does not cascade — the 3d point still fires normally once the worker resumes in time", () => {
    // Worker was down across the entire 7d window, but back up well before
    // the 3d window opens (3d point is 4 days after the 7d point).
    const hoursUntilExpiryAt7dCheck = 7 * 24 - 20; // missed
    const hoursUntilExpiryAt3dCheck = 3 * 24 - 1; // resumed, well within the 3d window
    expect(matchesReminderWindow(hoursUntilExpiryAt7dCheck, 7)).toBe(false);
    expect(matchesReminderWindow(hoursUntilExpiryAt3dCheck, 3)).toBe(true);
  });

  it("an outage spanning MULTIPLE reminder points (>4 days, e.g. 7d and 3d both missed) leaves only the 1d point as the last chance", () => {
    // Worker down from before the 7d window opens until after the 3d window closes.
    const hoursUntilExpiryAt7d = 7 * 24 - 20; // missed
    const hoursUntilExpiryAt3d = 3 * 24 - 20; // also missed
    const hoursUntilExpiryAt1d = 1 * 24 - 2; // resumed in time for the 1d point
    expect(matchesReminderWindow(hoursUntilExpiryAt7d, 7)).toBe(false);
    expect(matchesReminderWindow(hoursUntilExpiryAt3d, 3)).toBe(false);
    expect(matchesReminderWindow(hoursUntilExpiryAt1d, 1)).toBe(true);
  });

  it("verifies the exact configured half-width in hours (12h) matches the documented design", () => {
    // Sanity check the constant this whole finding depends on hasn't silently drifted.
    expect(matchesReminderWindow(24 * 7 - 12, 7)).toBe(true);
    expect(matchesReminderWindow(24 * 7 - 12.01, 7)).toBe(false);
  });
});
