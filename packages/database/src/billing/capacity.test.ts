import { describe, expect, it } from "vitest";
import {
  BillingCapacityError,
  CurrentOperationalMonthRequiredError,
  PlanStudentLimitReachedError,
  PlanTeamLimitReachedError,
  SubscriptionPlanUnmappedError,
  carryForwardDecision,
  resolveLimitsFor,
  studentEnrollmentDecision,
  teamActivationDecision,
} from "./capacity";

/**
 * Pure-rule unit tests. The DB-coupled asserts (counts, FOR UPDATE locking,
 * current-month resolution, concurrency) are proven separately against real
 * Postgres in `capacity-enforcement.integration.test.ts`; here we pin the
 * decision rules themselves so they can never silently drift.
 */

describe("studentEnrollmentDecision", () => {
  it("allows a new unique student below the limit", () => {
    expect(studentEnrollmentDecision({ limit: 500, currentUsage: 499, studentAlreadyActive: false })).toBe("ALLOW");
  });

  it("blocks a new unique student at the limit", () => {
    expect(studentEnrollmentDecision({ limit: 500, currentUsage: 500, studentAlreadyActive: false })).toBe("BLOCK");
  });

  it("ALWAYS allows an already-active student to join another group — even at the cap", () => {
    expect(studentEnrollmentDecision({ limit: 500, currentUsage: 500, studentAlreadyActive: true })).toBe("ALLOW");
    expect(studentEnrollmentDecision({ limit: 500, currentUsage: 501, studentAlreadyActive: true })).toBe("ALLOW");
  });

  it("blocks once over the limit (defensive)", () => {
    expect(studentEnrollmentDecision({ limit: 100, currentUsage: 120, studentAlreadyActive: false })).toBe("BLOCK");
  });
});

describe("teamActivationDecision", () => {
  it("allows activating a member below the team limit", () => {
    expect(teamActivationDecision({ limit: 2, currentUsage: 1 })).toBe("ALLOW");
  });

  it("blocks activating a member at the team limit", () => {
    expect(teamActivationDecision({ limit: 2, currentUsage: 2 })).toBe("BLOCK");
    expect(teamActivationDecision({ limit: 0, currentUsage: 0 })).toBe("BLOCK"); // STARTER: 0 assistants
  });
});

describe("carryForwardDecision", () => {
  it("allows carrying forward up to the limit", () => {
    expect(carryForwardDecision({ limit: 500, distinctStudentCount: 500 })).toBe("ALLOW");
    expect(carryForwardDecision({ limit: 500, distinctStudentCount: 480 })).toBe("ALLOW");
  });

  it("blocks a carry-forward that would exceed the limit (e.g. after a downgrade)", () => {
    expect(carryForwardDecision({ limit: 500, distinctStudentCount: 501 })).toBe("BLOCK");
  });
});

describe("capacity errors", () => {
  it("carry all the fields the API surfaces (no team internals leaked) + the filter marker", () => {
    const s = new PlanStudentLimitReachedError(500, 500, "PROFESSIONAL");
    expect(s).toBeInstanceOf(BillingCapacityError);
    expect(s.code).toBe("PLAN_STUDENT_LIMIT_REACHED");
    expect(s.httpStatus).toBe(409);
    expect(s.isBillingCapacityError).toBe(true);
    expect(s.details).toEqual({ currentUsage: 500, limit: 500, planCode: "PROFESSIONAL", upgradeRequired: true });

    const t = new PlanTeamLimitReachedError(2, 2, "PROFESSIONAL");
    expect(t.code).toBe("PLAN_TEAM_LIMIT_REACHED");
    expect(t.details).toEqual({ currentUsage: 2, limit: 2, planCode: "PROFESSIONAL", upgradeRequired: true });

    const m = new CurrentOperationalMonthRequiredError();
    expect(m.code).toBe("CURRENT_OPERATIONAL_MONTH_REQUIRED");
    expect(m.httpStatus).toBe(409);
    expect(m.isBillingCapacityError).toBe(true);
  });
});

describe("resolveLimitsFor — trusted, single-source, business-safe remap", () => {
  it("resolves TRIAL / standard / CUSTOM from the single-source catalog", () => {
    expect(resolveLimitsFor({ state: "TRIAL", planCode: null, customMaxActiveStudents: null, customMaxTeamMembers: null })).toEqual({ maxActiveStudents: 500, maxTeamMembers: 2 });
    expect(resolveLimitsFor({ state: "ACTIVE", planCode: "PROFESSIONAL", customMaxActiveStudents: null, customMaxTeamMembers: null })).toEqual({ maxActiveStudents: 500, maxTeamMembers: 2 });
    expect(resolveLimitsFor({ state: "ACTIVE", planCode: "CUSTOM", customMaxActiveStudents: 4200, customMaxTeamMembers: 20 })).toEqual({ maxActiveStudents: 4200, maxTeamMembers: 20 });
  });

  it("remaps a legacy/unmapped subscription to SubscriptionPlanUnmappedError (never a raw 500, no leaked reason)", () => {
    try {
      resolveLimitsFor({ state: "ACTIVE", planCode: null, customMaxActiveStudents: null, customMaxTeamMembers: null });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SubscriptionPlanUnmappedError);
      expect((err as SubscriptionPlanUnmappedError).code).toBe("SUBSCRIPTION_PLAN_UNMAPPED");
      expect((err as SubscriptionPlanUnmappedError).httpStatus).toBe(409);
      expect((err as SubscriptionPlanUnmappedError).isBillingCapacityError).toBe(true);
      expect((err as SubscriptionPlanUnmappedError).details).toBeUndefined(); // no internal reason leaked
    }
  });

  it("remaps a CUSTOM subscription missing its stored limits the same way", () => {
    expect(() => resolveLimitsFor({ state: "ACTIVE", planCode: "CUSTOM", customMaxActiveStudents: null, customMaxTeamMembers: null })).toThrow(SubscriptionPlanUnmappedError);
  });
});
