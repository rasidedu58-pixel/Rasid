import { describe, expect, it } from "vitest";
import { deriveEligibleEnrollmentIds, isEnrollmentEligibleForSession } from "./roster";

const TZ = "Africa/Cairo";

describe("Session roster eligibility (Phase 5)", () => {
  it("excludes a student who joined AFTER the session date (AC-06)", () => {
    const eligible = isEnrollmentEligibleForSession({
      enrollment: { enrollmentId: "e1", joinDate: "2026-08-15", endedAt: null },
      sessionScheduledAt: new Date("2026-08-10T08:00:00Z"),
      workspaceTimezone: TZ,
    });
    expect(eligible).toBe(false);
  });

  it("includes a student on the SAME day they joined (join-date eligibility: same-day session eligible)", () => {
    const eligible = isEnrollmentEligibleForSession({
      enrollment: { enrollmentId: "e1", joinDate: "2026-08-10", endedAt: null },
      sessionScheduledAt: new Date("2026-08-10T08:00:00Z"),
      workspaceTimezone: TZ,
    });
    expect(eligible).toBe(true);
  });

  it("excludes a student whose enrollment already ended ON/BEFORE the session date", () => {
    const eligibleSameDay = isEnrollmentEligibleForSession({
      enrollment: { enrollmentId: "e1", joinDate: "2026-08-01", endedAt: new Date("2026-08-10T00:00:00Z") },
      sessionScheduledAt: new Date("2026-08-10T08:00:00Z"),
      workspaceTimezone: TZ,
    });
    expect(eligibleSameDay).toBe(false);

    const eligibleAfter = isEnrollmentEligibleForSession({
      enrollment: { enrollmentId: "e1", joinDate: "2026-08-01", endedAt: new Date("2026-08-05T00:00:00Z") },
      sessionScheduledAt: new Date("2026-08-10T08:00:00Z"),
      workspaceTimezone: TZ,
    });
    expect(eligibleAfter).toBe(false);
  });

  it("includes a student whose enrollment ends AFTER the session date", () => {
    const eligible = isEnrollmentEligibleForSession({
      enrollment: { enrollmentId: "e1", joinDate: "2026-08-01", endedAt: new Date("2026-08-20T00:00:00Z") },
      sessionScheduledAt: new Date("2026-08-10T08:00:00Z"),
      workspaceTimezone: TZ,
    });
    expect(eligible).toBe(true);
  });

  it("deriveEligibleEnrollmentIds returns each eligible enrollment exactly once", () => {
    const ids = deriveEligibleEnrollmentIds({
      enrollments: [
        { enrollmentId: "e1", joinDate: "2026-08-01", endedAt: null },
        { enrollmentId: "e2", joinDate: "2026-08-15", endedAt: null }, // joins after
        { enrollmentId: "e3", joinDate: "2026-08-01", endedAt: new Date("2026-08-05T00:00:00Z") }, // ended before
      ],
      sessionScheduledAt: new Date("2026-08-10T08:00:00Z"),
      workspaceTimezone: TZ,
    });
    expect(ids).toEqual(["e1"]);
  });
});
