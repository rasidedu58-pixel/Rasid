import { describe, expect, it } from "vitest";
import {
  ALL_NOTIFICATION_TYPES,
  BILLING_NOTIFICATION_TYPES,
  LEGACY_NOTIFICATION_TYPES,
  TEAM_NOTIFICATION_TYPES,
  billingNotificationAudience,
  reminderMilestoneDedupKey,
  lifecycleTerminalDedupKey,
  paymentRequestDedupKey,
  paymentRequestExpiringDedupKey,
  customOfferDedupKey,
  customOfferExpiringDedupKey,
  capacityThresholdDedupKey,
  formatEgpMinor,
  trialEndingContent,
  subscriptionExpiredContent,
  paymentRejectedContent,
  capacityContent,
  newPaymentProofPendingContent,
  teamInviteAcceptedContent,
  teamInviteAcceptedDedupKey,
  paymentProofPendingDedupKey,
} from "./billing-notifications";

describe("billing notification types + audience", () => {
  it("keeps the legacy types so historical rows stay valid, and adds the billing set", () => {
    expect(LEGACY_NOTIFICATION_TYPES).toContain("SUBSCRIPTION_EXPIRING");
    expect(ALL_NOTIFICATION_TYPES).toEqual([...LEGACY_NOTIFICATION_TYPES, ...BILLING_NOTIFICATION_TYPES, ...TEAM_NOTIFICATION_TYPES]);
    // No accidental duplicates in the CHECK source list.
    expect(new Set(ALL_NOTIFICATION_TYPES).size).toBe(ALL_NOTIFICATION_TYPES.length);
  });
  it("routes platform types to PLATFORM, customer types to CUSTOMER", () => {
    expect(billingNotificationAudience("CUSTOM_REQUEST_CREATED")).toBe("PLATFORM");
    expect(billingNotificationAudience("NEW_PAYMENT_PROOF_PENDING")).toBe("PLATFORM");
    expect(billingNotificationAudience("TRIAL_ENDING")).toBe("CUSTOMER");
    expect(billingNotificationAudience("CAPACITY_STUDENTS")).toBe("CUSTOMER");
  });
});

describe("dedup keys — deterministic + distinct per band/milestone", () => {
  it("reminder milestone keys are per-day", () => {
    expect(reminderMilestoneDedupKey(7)).toBe("7d");
    expect(reminderMilestoneDedupKey(1)).toBe("1d");
  });
  it("terminal key is per period-end epoch (a new period re-arms)", () => {
    expect(lifecycleTerminalDedupKey(1730000000000)).toBe("end:1730000000000");
    expect(lifecycleTerminalDedupKey(1)).not.toBe(lifecycleTerminalDedupKey(2));
  });
  it("payment request keys separate 'created/expired' from the 24h warning", () => {
    expect(paymentRequestDedupKey("req1")).toBe("req1");
    expect(paymentRequestExpiringDedupKey("req1")).toBe("req1:24h");
  });
  it("offer keys separate lifecycle from expiring milestones", () => {
    expect(customOfferDedupKey("o1")).toBe("o1");
    expect(customOfferExpiringDedupKey("o1", 3)).toBe("o1:3d");
    expect(customOfferExpiringDedupKey("o1", 1)).toBe("o1:1d");
  });
  it("capacity keys are per (kind, period, band)", () => {
    expect(capacityThresholdDedupKey("STUDENTS", "m1", 90)).toBe("capacity:STUDENTS:m1:90");
    expect(capacityThresholdDedupKey("TEAM", "p1", 100)).toBe("capacity:TEAM:p1:100");
    expect(capacityThresholdDedupKey("STUDENTS", "m1", 90)).not.toBe(capacityThresholdDedupKey("STUDENTS", "m1", 95));
  });
});

describe("copy — Arabic, MONTHLY-only (no annual wording)", () => {
  it("formats EGP from minor units", () => {
    expect(formatEgpMinor(30000)).toBe("300 ج.م");
    expect(formatEgpMinor(18050)).toBe("180.50 ج.م");
  });
  it("trial-ending copy mentions the monthly subscription, not annual", () => {
    const c = trialEndingContent("مدرسة النور", 3);
    expect(c.body).toContain("مدرسة النور");
    expect(c.body).toContain("شهري");
    expect(c.body).not.toMatch(/سنوي|سنة/);
  });
  it("subscription-expired copy reassures data is kept", () => {
    expect(subscriptionExpiredContent("X").body).toContain("محفوظة");
  });
  it("payment-rejected copy appends a safe reason only when present, never leaks internal notes otherwise", () => {
    expect(paymentRejectedContent("RSD-ABCDE", "لم يصل التحويل").body).toContain("لم يصل التحويل");
    expect(paymentRejectedContent("RSD-ABCDE", null).body).not.toContain("undefined");
  });
  it("capacity 100% copy prompts a plan change; 90/95 is a soft warning", () => {
    expect(capacityContent("STUDENTS", 100).body).toContain("الحد الأقصى");
    expect(capacityContent("TEAM", 90).body).toContain("90%");
  });
});

describe("the two notifications this phase made real", () => {
  it("names the member and the workspace, and never renders an empty subject", () => {
    expect(teamInviteAcceptedContent("محمد أحمد", "أكاديمية النور")).toEqual({
      title: "تم انضمام عضو جديد للفريق",
      body: "محمد أحمد انضم إلى مساحة العمل «أكاديمية النور».",
    });
    expect(teamInviteAcceptedContent(null, "أكاديمية النور").body).toContain("عضو جديد");
    expect(teamInviteAcceptedContent("   ", "أكاديمية النور").body).toContain("عضو جديد");
  });

  it("tells staff who asked, which plan and how much — without opening the row", () => {
    const content = newPaymentProofPendingContent({
      humanCode: "RS-ABC123",
      workspaceName: "أكاديمية النور",
      requesterName: "أ. سارة",
      planName: "احترافي",
      amountMinor: 30000,
    });
    expect(content.title).toBe("طلب دفع جديد يحتاج مراجعة");
    expect(content.body).toBe("أ. سارة (أكاديمية النور) — احترافي — 300 ج.م (كود RS-ABC123).");
  });

  it("falls back to the workspace name when the requester has none", () => {
    const content = newPaymentProofPendingContent({
      humanCode: "RS-X",
      workspaceName: "أكاديمية النور",
      requesterName: null,
      planName: "نمو",
      amountMinor: 18000,
    });
    expect(content.body).toContain("أكاديمية النور");
  });

  it("dedupes a join by the membership that proves it, and a review alert by the request", () => {
    // Both are the id of the row whose creation is the event — created once,
    // so a retried/replayed event converges on one notification.
    expect(teamInviteAcceptedDedupKey("mem-1")).toBe("mem-1");
    expect(paymentProofPendingDedupKey("pr-1")).toBe("pr-1");
  });
});
