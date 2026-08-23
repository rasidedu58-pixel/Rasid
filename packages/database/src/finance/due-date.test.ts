import { describe, expect, it } from "vitest";
import { computeObligationDueDate } from "./due-date";

describe("computeObligationDueDate (Phase 6)", () => {
  it("returns the exact calendar date for a normal day-of-month", () => {
    const date = computeObligationDueDate({ year: 2026, month: 8, dueDay: 15, workspaceTimezone: "Africa/Cairo" });
    expect(date).toBe("2026-08-15");
  });

  it("clamps to the last real day of a short month (e.g. day 30 in February)", () => {
    const date = computeObligationDueDate({ year: 2026, month: 2, dueDay: 30, workspaceTimezone: "Africa/Cairo" });
    expect(date).toBe("2026-02-28");
  });

  it("clamps day 29 in a leap-year February to the 29th itself (not truncated further)", () => {
    const date = computeObligationDueDate({ year: 2028, month: 2, dueDay: 29, workspaceTimezone: "Africa/Cairo" });
    expect(date).toBe("2028-02-29");
  });

  it("clamps a below-range day up to 1", () => {
    const date = computeObligationDueDate({ year: 2026, month: 8, dueDay: 0, workspaceTimezone: "Africa/Cairo" });
    expect(date).toBe("2026-08-01");
  });
});
