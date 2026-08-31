import { describe, expect, it } from "vitest";
import {
  completeTeacherOnboardingRequestSchema,
  governorateSchema,
  isTeacherProfileComplete,
  normalizeEgyptianPhone,
  shouldForceTeacherOnboarding,
  subjectSchema,
  updateTeacherProfileRequestSchema,
} from "./teacher-profile";

describe("normalizeEgyptianPhone", () => {
  it("normalizes the common Egyptian mobile forms to +20…", () => {
    expect(normalizeEgyptianPhone("01012345678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone("+201012345678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone("00201012345678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone("201012345678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone("010 1234 5678")).toBe("+201012345678");
    expect(normalizeEgyptianPhone("011-2345-6789")).toBe("+201123456789");
  });

  it("rejects non-Egyptian / malformed numbers", () => {
    expect(normalizeEgyptianPhone("0123456")).toBeNull(); // too short
    expect(normalizeEgyptianPhone("0191234567")).toBeNull(); // 019 not a valid prefix
    expect(normalizeEgyptianPhone("+15551234567")).toBeNull(); // US number
    expect(normalizeEgyptianPhone("")).toBeNull();
    expect(normalizeEgyptianPhone(null)).toBeNull();
  });
});

describe("governorate + subject validation", () => {
  it("accepts known codes and rejects unknown ones", () => {
    expect(governorateSchema.safeParse("CAIRO").success).toBe(true);
    expect(governorateSchema.safeParse("ATLANTIS").success).toBe(false);
    expect(subjectSchema.safeParse("MATH").success).toBe(true);
    expect(subjectSchema.safeParse("ASTROLOGY").success).toBe(false);
  });
});

describe("subject OTHER requires subject_other", () => {
  it("onboarding: OTHER without text fails, with text passes", () => {
    const base = { phone: "01012345678", governorate: "CAIRO" };
    expect(completeTeacherOnboardingRequestSchema.safeParse({ ...base, subject: "OTHER" }).success).toBe(false);
    expect(completeTeacherOnboardingRequestSchema.safeParse({ ...base, subject: "OTHER", subjectOther: "علم النفس" }).success).toBe(true);
    expect(completeTeacherOnboardingRequestSchema.safeParse({ ...base, subject: "MATH" }).success).toBe(true);
  });

  it("onboarding rejects an invalid phone", () => {
    expect(completeTeacherOnboardingRequestSchema.safeParse({ phone: "0191234567", governorate: "CAIRO", subject: "MATH" }).success).toBe(false);
  });

  it("settings update requires at least one field", () => {
    expect(updateTeacherProfileRequestSchema.safeParse({}).success).toBe(false);
    expect(updateTeacherProfileRequestSchema.safeParse({ governorate: "GIZA" }).success).toBe(true);
  });
});

describe("isTeacherProfileComplete", () => {
  it("is true only when all required fields are present (and OTHER has text)", () => {
    expect(isTeacherProfileComplete({ phone: "+201012345678", governorate: "CAIRO", subject: "MATH" })).toBe(true);
    expect(isTeacherProfileComplete({ phone: null, governorate: "CAIRO", subject: "MATH" })).toBe(false);
    expect(isTeacherProfileComplete({ phone: "+201012345678", governorate: "CAIRO", subject: "OTHER" })).toBe(false);
    expect(isTeacherProfileComplete({ phone: "+201012345678", governorate: "CAIRO", subject: "OTHER", subjectOther: "علم النفس" })).toBe(true);
  });
});

describe("shouldForceTeacherOnboarding", () => {
  const base = { workspaceReady: true, isOwner: true, isPlatformStaff: false, profileCompleted: false };
  it("forces an owner with an incomplete profile", () => {
    expect(shouldForceTeacherOnboarding(base)).toBe(true);
  });
  it("does NOT force once the profile is complete (→ app)", () => {
    expect(shouldForceTeacherOnboarding({ ...base, profileCompleted: true })).toBe(false);
  });
  it("does NOT force a platform-staff user (item 15)", () => {
    expect(shouldForceTeacherOnboarding({ ...base, isPlatformStaff: true })).toBe(false);
  });
  it("does NOT force a non-owner (invited assistant)", () => {
    expect(shouldForceTeacherOnboarding({ ...base, isOwner: false })).toBe(false);
  });
  it("does NOT force before the workspace is ready", () => {
    expect(shouldForceTeacherOnboarding({ ...base, workspaceReady: false })).toBe(false);
  });
});
