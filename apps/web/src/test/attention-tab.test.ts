import { describe, expect, it } from "vitest";
import { initialAttentionTab } from "../app/(app)/attention/attention-tab";

describe("initialAttentionTab — deep-link ?tab honoring (dashboard follow-up regression)", () => {
  it("opens the followups tab when ?tab=followups (the dashboard's متابعة مستحقة link)", () => {
    // Regression: the page used to hard-code the cases tab, so a follow-up
    // clicked on the dashboard landed on a page that never showed it.
    expect(initialAttentionTab("followups")).toBe("followups");
  });

  it("defaults to the cases tab for no param, an unknown param, or the cases param", () => {
    expect(initialAttentionTab(null)).toBe("cases");
    expect(initialAttentionTab(undefined)).toBe("cases");
    expect(initialAttentionTab("cases")).toBe("cases");
    expect(initialAttentionTab("anything-else")).toBe("cases");
  });
});
