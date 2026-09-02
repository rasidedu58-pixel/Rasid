import { describe, expect, it } from "vitest";
import { nextSessionWhen } from "../app/(app)/dashboard/next-session-label";

// All Dates are built from LOCAL components (new Date(y, m, d, h, ...)) and
// transported as the corresponding UTC instant, so the local-day assertions
// below hold regardless of the machine timezone the test runs in.
const iso = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).toISOString();

describe("nextSessionWhen — Next/Current session 'when' line", () => {
  it("shows a live label for an in-progress session (ignores the clock)", () => {
    expect(nextSessionWhen(iso(2026, 8, 2, 9, 0), "IN_PROGRESS", new Date(2026, 8, 2, 12, 0).getTime())).toContain("جارية الآن");
  });

  it("counts down within the hour", () => {
    const now = new Date(2026, 8, 2, 10, 0).getTime();
    expect(nextSessionWhen(iso(2026, 8, 2, 10, 25), "SCHEDULED", now)).toContain("تبدأ بعد");
  });

  it("labels a later session TODAY with اليوم", () => {
    const now = new Date(2026, 8, 2, 9, 0).getTime();
    expect(nextSessionWhen(iso(2026, 8, 2, 18, 0), "SCHEDULED", now)).toContain("اليوم");
  });

  it("labels the next calendar day with غدًا (the added case)", () => {
    const now = new Date(2026, 8, 2, 20, 0).getTime();
    const label = nextSessionWhen(iso(2026, 8, 3, 10, 0), "SCHEDULED", now);
    expect(label).toContain("غدًا");
    expect(label).not.toContain("اليوم");
  });

  it("does NOT call 23:50-today 'tomorrow' for the local reader (timezone boundary)", () => {
    const now = new Date(2026, 8, 2, 9, 0).getTime();
    // 23:50 the same local day must stay اليوم, never غدًا.
    const label = nextSessionWhen(iso(2026, 8, 2, 23, 50), "SCHEDULED", now);
    expect(label).toContain("اليوم");
    expect(label).not.toContain("غدًا");
  });

  it("falls back to a full date for sessions beyond tomorrow", () => {
    const now = new Date(2026, 8, 2, 9, 0).getTime();
    const label = nextSessionWhen(iso(2026, 8, 10, 10, 0), "SCHEDULED", now);
    expect(label).not.toContain("اليوم");
    expect(label).not.toContain("غدًا");
  });
});
