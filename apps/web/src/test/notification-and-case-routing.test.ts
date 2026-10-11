import { describe, expect, it } from "vitest";
import { attentionResolutionRoute, ALL_NOTIFICATION_TYPES, notificationTypeSchema } from "@academic-precision/contracts";
import { actionItemHref } from "../app/(app)/dashboard/action-item-link";

/**
 * Two routing contracts the user actually feels:
 *   - clicking a notification must land on the thing it is about;
 *   - a case's CTA must open the screen where that reason is fixed.
 */
describe("notification action links", () => {
  it("routes every billing notification's entity to billing, not to the dashboard", () => {
    // These used to fall through the switch's default and dump the user on
    // /dashboard, which says nothing about the payment they just clicked.
    expect(actionItemHref("payment_request", "p1")).toBe("/settings?tab=billing");
    expect(actionItemHref("subscription", "s1")).toBe("/settings?tab=billing");
  });

  it("keeps the existing destinations intact", () => {
    expect(actionItemHref("attention_case", "c1")).toBe("/attention/c1");
    expect(actionItemHref("session", "s1")).toBe("/sessions/s1");
    expect(actionItemHref("scheduled_followup", "f1")).toBe("/attention?tab=followups");
    expect(actionItemHref("financial_obligation", "o1")).toBe("/finance");
    expect(actionItemHref("student", "st1")).toBe("/students/st1");
  });

  it("still falls back safely for a type it does not know", () => {
    expect(actionItemHref("something_new", "x")).toBe("/dashboard");
  });

  it("the notification DTO accepts every type the system can store", () => {
    // The enum had drifted to 3 of 21: a real PAYMENT_CONFIRMED row failed
    // to parse against the contract it is supposed to satisfy.
    for (const type of ALL_NOTIFICATION_TYPES) {
      expect(notificationTypeSchema.safeParse(type).success).toBe(true);
    }
    expect(notificationTypeSchema.safeParse("PAYMENT_CONFIRMED").success).toBe(true);
    expect(notificationTypeSchema.safeParse("FOLLOWUP_DUE").success).toBe(true);
    expect(notificationTypeSchema.safeParse("NOT_A_REAL_TYPE").success).toBe(false);
  });
});

describe("attention case CTA", () => {
  it("sends attendance and homework reasons to the sessions, where those records live", () => {
    expect(attentionResolutionRoute("absence.frequency").target).toEqual({ kind: "SESSIONS" });
    expect(attentionResolutionRoute("absence.consecutive").target).toEqual({ kind: "SESSIONS" });
    expect(attentionResolutionRoute("homework.frequency").target).toEqual({ kind: "SESSIONS" });
    expect(attentionResolutionRoute("homework.consecutive").target).toEqual({ kind: "SESSIONS" });
  });

  it("sends an exam reason to the student's own record", () => {
    expect(attentionResolutionRoute("exam.low").target).toEqual({ kind: "STUDENT_TAB", tab: "overview" });
  });

  it("covers the legacy UPPER_SNAKE rule keys the same way", () => {
    expect(attentionResolutionRoute("ATTENDANCE_ABSENCE_STREAK").target).toEqual({ kind: "SESSIONS" });
    expect(attentionResolutionRoute("LOW_EXAM_SCORE").target).toEqual({ kind: "STUDENT_TAB", tab: "overview" });
  });

  it("falls back to contacting the guardian rather than guessing a screen", () => {
    expect(attentionResolutionRoute(null).target).toEqual({ kind: "FOLLOW_UP" });
    expect(attentionResolutionRoute("unknown.rule").target).toEqual({ kind: "FOLLOW_UP" });
  });

  it("always offers an imperative label, never an empty button", () => {
    for (const key of ["absence.frequency", "homework.consecutive", "exam.low", "combined.medium", "unknown"]) {
      expect(attentionResolutionRoute(key).label.trim().length).toBeGreaterThan(0);
    }
  });
});
