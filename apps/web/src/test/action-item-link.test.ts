import { describe, expect, it } from "vitest";
import { actionItemHref } from "../app/(app)/dashboard/action-item-link";

describe("actionItemHref", () => {
  it("maps attention_case to the case detail route", () => {
    expect(actionItemHref("attention_case", "abc")).toBe("/attention/abc");
  });

  it("maps session to the session mode route", () => {
    expect(actionItemHref("session", "xyz")).toBe("/sessions/xyz");
  });

  it("maps scheduled_followup to the attention followups tab", () => {
    expect(actionItemHref("scheduled_followup", "any")).toBe("/attention?tab=followups");
  });

  it("maps financial_obligation to the finance page", () => {
    expect(actionItemHref("financial_obligation", "any")).toBe("/finance");
  });

  it("falls back to the dashboard for an unrecognized entityType rather than throwing", () => {
    expect(actionItemHref("unknown_type", "any")).toBe("/dashboard");
  });
});
