import { describe, expect, it } from "vitest";
import {
  PLATFORM_LEAD_FILTERS,
  PLATFORM_LEAD_STATUSES,
  buildWhatsappLink,
  normalizeWhatsappPhone,
  platformLeadStatusSchema,
  updatePlatformLeadRequestSchema,
} from "./platform-leads";
import { hasPlatformPermission, ROLE_PERMISSIONS, type PlatformRole } from "./platform-operations";

describe("normalizeWhatsappPhone — Egypt-first E.164", () => {
  it("converts a national 0-prefixed mobile to country code 20", () => {
    expect(normalizeWhatsappPhone("01012345678")).toBe("201012345678");
  });

  it("strips spaces, dashes and parens", () => {
    expect(normalizeWhatsappPhone("010 1234 5678")).toBe("201012345678");
    expect(normalizeWhatsappPhone("010-1234-5678")).toBe("201012345678");
    expect(normalizeWhatsappPhone("(010) 1234 5678")).toBe("201012345678");
  });

  it("accepts an already-international number with +", () => {
    expect(normalizeWhatsappPhone("+201012345678")).toBe("201012345678");
  });

  it("accepts a 00-prefixed international number", () => {
    expect(normalizeWhatsappPhone("00201012345678")).toBe("201012345678");
  });

  it("prefixes a bare 10-digit mobile", () => {
    expect(normalizeWhatsappPhone("1012345678")).toBe("201012345678");
  });

  it("returns null for empty / nullish / too-short input", () => {
    expect(normalizeWhatsappPhone("")).toBeNull();
    expect(normalizeWhatsappPhone(null)).toBeNull();
    expect(normalizeWhatsappPhone(undefined)).toBeNull();
    expect(normalizeWhatsappPhone("12345")).toBeNull();
  });

  it("honours a non-Egypt default country code", () => {
    expect(normalizeWhatsappPhone("0512345678", "966")).toBe("966512345678");
  });
});

describe("buildWhatsappLink — opens a chat, never sends", () => {
  it("builds a wa.me link with an encoded, prefilled message", () => {
    const link = buildWhatsappLink("01012345678", "مرحبا");
    expect(link).toBe(`https://wa.me/201012345678?text=${encodeURIComponent("مرحبا")}`);
  });

  it("builds a bare chat link when no message is given", () => {
    expect(buildWhatsappLink("01012345678")).toBe("https://wa.me/201012345678");
  });

  it("uses only the documented wa.me deep-link (no auto-send / API-send endpoint)", () => {
    const link = buildWhatsappLink("01012345678", "مرحبا")!;
    expect(link.startsWith("https://wa.me/")).toBe(true);
    expect(link).not.toContain("send?"); // never the send API
  });

  it("returns null when the phone can't be normalized (button is hidden)", () => {
    expect(buildWhatsappLink(null)).toBeNull();
    expect(buildWhatsappLink("nope")).toBeNull();
  });
});

describe("platform lead permissions — platform-admin only", () => {
  const roles: PlatformRole[] = ["PLATFORM_OWNER", "OPERATIONS_ADMIN", "SUPPORT_AGENT"];

  it("grants every platform role both view and manage", () => {
    for (const role of roles) {
      expect(hasPlatformPermission(role, "platform.leads.view")).toBe(true);
      expect(hasPlatformPermission(role, "platform.leads.manage")).toBe(true);
    }
  });

  it("denies a null / absent platform role (a workspace owner has none)", () => {
    expect(hasPlatformPermission(null, "platform.leads.view")).toBe(false);
    expect(hasPlatformPermission(undefined, "platform.leads.manage")).toBe(false);
  });

  it("wires the lead permissions into the role map (no orphan keys)", () => {
    expect(ROLE_PERMISSIONS.PLATFORM_OWNER).toContain("platform.leads.view");
    expect(ROLE_PERMISSIONS.SUPPORT_AGENT).toContain("platform.leads.manage");
  });
});

describe("lead status + filter enums", () => {
  it("exposes exactly the agreed statuses", () => {
    expect(PLATFORM_LEAD_STATUSES).toEqual(["NEW", "CONTACTED", "FOLLOW_UP", "POSTPONED", "CONVERTED", "NOT_INTERESTED"]);
  });
  it("exposes the named UI filters", () => {
    expect(PLATFORM_LEAD_FILTERS).toContain("NEEDS_FOLLOW_UP");
    expect(PLATFORM_LEAD_FILTERS).toContain("ALL");
  });
  it("validates a known status and rejects an unknown one", () => {
    expect(platformLeadStatusSchema.safeParse("CONVERTED").success).toBe(true);
    expect(platformLeadStatusSchema.safeParse("WON").success).toBe(false);
  });
});

describe("updatePlatformLeadRequestSchema — follow-up edits", () => {
  it("accepts a status-only change", () => {
    expect(updatePlatformLeadRequestSchema.safeParse({ status: "CONTACTED" }).success).toBe(true);
  });

  it("accepts a follow-up date and a clearing null", () => {
    expect(updatePlatformLeadRequestSchema.safeParse({ nextFollowUpAt: "2026-10-01T00:00:00.000Z" }).success).toBe(true);
    expect(updatePlatformLeadRequestSchema.safeParse({ nextFollowUpAt: null }).success).toBe(true);
  });

  it("accepts a note (including clearing to null) and markContactedNow", () => {
    expect(updatePlatformLeadRequestSchema.safeParse({ note: "اتصلت، طلب معاودة" }).success).toBe(true);
    expect(updatePlatformLeadRequestSchema.safeParse({ note: null }).success).toBe(true);
    expect(updatePlatformLeadRequestSchema.safeParse({ markContactedNow: true }).success).toBe(true);
  });

  it("rejects an empty (no-change) body", () => {
    expect(updatePlatformLeadRequestSchema.safeParse({}).success).toBe(false);
    expect(updatePlatformLeadRequestSchema.safeParse({ markContactedNow: false }).success).toBe(false);
  });

  it("rejects an invalid status or a non-datetime follow-up", () => {
    expect(updatePlatformLeadRequestSchema.safeParse({ status: "WON" }).success).toBe(false);
    expect(updatePlatformLeadRequestSchema.safeParse({ nextFollowUpAt: "2026-10-01" }).success).toBe(false);
  });
});
