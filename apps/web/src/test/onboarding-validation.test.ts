import { describe, expect, it } from "vitest";
import { onboardingCompleteRequestSchema } from "@academic-precision/contracts";

/**
 * Pure logic test for the onboarding due-date-policy validation rule
 * (PRD §29.3 Acceptance Criteria): unifiedDueDay is required only when
 * dueDatePolicy = UNIFIED, and forbidden otherwise. apps/web reuses the
 * same shared schema (@academic-precision/contracts) for inline
 * validation that apps/api uses server-side — this test proves both
 * directions work from apps/web's perspective.
 */
describe("onboardingCompleteRequestSchema (shared with apps/api)", () => {
  it("rejects UNIFIED policy without unifiedDueDay", () => {
    const result = onboardingCompleteRequestSchema.safeParse({
      displayName: "أ. محمد",
      dueDatePolicy: "UNIFIED",
    });
    expect(result.success).toBe(false);
  });

  it("rejects PER_GROUP policy with unifiedDueDay present", () => {
    const result = onboardingCompleteRequestSchema.safeParse({
      displayName: "أ. محمد",
      dueDatePolicy: "PER_GROUP",
      unifiedDueDay: 5,
    });
    expect(result.success).toBe(false);
  });

  it("accepts PER_GROUP policy without unifiedDueDay", () => {
    const result = onboardingCompleteRequestSchema.safeParse({
      displayName: "أ. محمد",
      dueDatePolicy: "PER_GROUP",
    });
    expect(result.success).toBe(true);
  });

  it("accepts UNIFIED policy with a valid unifiedDueDay", () => {
    const result = onboardingCompleteRequestSchema.safeParse({
      displayName: "أ. محمد",
      dueDatePolicy: "UNIFIED",
      unifiedDueDay: 15,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty displayName", () => {
    const result = onboardingCompleteRequestSchema.safeParse({
      displayName: "",
      dueDatePolicy: "PER_GROUP",
    });
    expect(result.success).toBe(false);
  });
});
