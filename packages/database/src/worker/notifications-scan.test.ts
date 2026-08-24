import { describe, expect, it } from "vitest";
import { matchesReminderWindow } from "./notifications-scan";

describe("matchesReminderWindow — subscription reminder window matching (7d/3d/1d)", () => {
  it("matches exactly at the reminder point", () => {
    expect(matchesReminderWindow(7 * 24, 7)).toBe(true);
    expect(matchesReminderWindow(3 * 24, 3)).toBe(true);
    expect(matchesReminderWindow(1 * 24, 1)).toBe(true);
  });

  it("still matches when the worker is delayed by minutes/hours (window-based, not exact-instant)", () => {
    expect(matchesReminderWindow(7 * 24 - 2, 7)).toBe(true); // 2 hours late
    expect(matchesReminderWindow(7 * 24 - 11.9, 7)).toBe(true); // nearly a half-day late — still inside the 12h half-width
  });

  it("does not match outside the window", () => {
    expect(matchesReminderWindow(7 * 24 - 13, 7)).toBe(false);
    expect(matchesReminderWindow(5 * 24, 7)).toBe(false);
  });

  it("adjacent reminder points (7d vs 3d) never both match the same value — no double-fire", () => {
    const hoursUntilExpiry = 5 * 24; // roughly halfway between 3d and 7d
    expect(matchesReminderWindow(hoursUntilExpiry, 7)).toBe(false);
    expect(matchesReminderWindow(hoursUntilExpiry, 3)).toBe(false);
  });
});
