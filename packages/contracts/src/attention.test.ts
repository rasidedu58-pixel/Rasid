import { describe, expect, it } from "vitest";
import { ATTENTION_RULE_LABEL, attentionRuleLabel } from "./attention";

describe("attentionRuleLabel — human-readable attention reasons", () => {
  it("maps every known rule key to a concrete Arabic reason (never a generic title)", () => {
    expect(attentionRuleLabel("ATTENDANCE_ABSENCE_STREAK")).toBe("غياب متكرر");
    expect(attentionRuleLabel("HOMEWORK_NOT_DONE_STREAK")).toBe("تقصير متكرر في الواجب");
    expect(attentionRuleLabel("LOW_EXAM_SCORE")).toBe("درجة امتحان منخفضة");
  });

  it("keeps the label table and the lookup in sync", () => {
    for (const [key, label] of Object.entries(ATTENTION_RULE_LABEL)) {
      expect(attentionRuleLabel(key)).toBe(label);
    }
  });

  it("falls back to a safe generic label ONLY for an unknown/absent rule", () => {
    expect(attentionRuleLabel("SOMETHING_NEW")).toBe("حالة تحتاج متابعة");
    expect(attentionRuleLabel(null)).toBe("حالة تحتاج متابعة");
    expect(attentionRuleLabel(undefined)).toBe("حالة تحتاج متابعة");
  });
});
