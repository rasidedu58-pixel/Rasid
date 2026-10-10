import { describe, expect, it } from "vitest";
import {
  DUE_DAY_EXPLAINER,
  DUE_DAY_RANGE_HINT,
  DUE_POLICY_OPTIONS,
  DUE_POLICY_VALUE_LABEL,
  GROUP_MONTH_FIELD_LABEL,
  JOIN_FEE_POLICY_OPTIONS,
  JOIN_FEE_POLICY_VALUE_LABEL,
  MONTH_CONFIG_SCOPE_NOTE,
  formatGroupMonthFieldValue,
} from "../lib/group-config-labels";

/**
 * The monthly-settings vocabulary. These are product decisions, not styling:
 * a raw enum or an English field name reaching the teacher's screen is the
 * defect this pins.
 */
describe("group monthly-settings labels", () => {
  it("covers every stored duePolicy / joinFeePolicy value, so no raw enum can reach the UI", () => {
    // Exactly the values in the group_months CHECK constraints.
    for (const value of ["UNIFIED", "PER_GROUP", "OVERRIDE"]) {
      expect(DUE_POLICY_VALUE_LABEL[value]).toBeTruthy();
    }
    for (const value of ["ASK_EVERY_TIME", "FULL", "REMAINING"]) {
      expect(JOIN_FEE_POLICY_VALUE_LABEL[value]).toBeTruthy();
    }
    expect(DUE_POLICY_OPTIONS).toHaveLength(3);
    expect(JOIN_FEE_POLICY_OPTIONS).toHaveLength(3);
  });

  it("offers the three join outcomes a teacher has to choose between", () => {
    expect(JOIN_FEE_POLICY_OPTIONS.map((o) => o.value)).toEqual(["FULL", "REMAINING", "ASK_EVERY_TIME"]);
  });

  it("explains the collection day in plain words, and says why the range stops at 28", () => {
    expect(DUE_DAY_EXPLAINER).toContain("5");
    expect(DUE_DAY_RANGE_HINT).toContain("28");
  });

  it("states the edit scope: this month, existing obligations untouched, next month inherits", () => {
    expect(MONTH_CONFIG_SCOPE_NOTE).toContain("هذا الشهر");
    expect(MONTH_CONFIG_SCOPE_NOTE).toContain("لا تتغير");
    expect(MONTH_CONFIG_SCOPE_NOTE).toContain("الشهر القادم");
  });

  it("renders a change-preview diff in Arabic with money in pounds, never minor units", () => {
    expect(GROUP_MONTH_FIELD_LABEL.baseFeeMinor).toBe("الرسوم الشهرية");
    // ar-EG renders Arabic-Indic digits, the same locale formatMoney uses.
    expect(formatGroupMonthFieldValue("baseFeeMinor", 30000)).toBe("٣٠٠ جنيه");
    expect(formatGroupMonthFieldValue("duePolicy", "PER_GROUP")).toBe(DUE_POLICY_VALUE_LABEL.PER_GROUP);
    expect(formatGroupMonthFieldValue("joinFeePolicy", "REMAINING")).toBe(JOIN_FEE_POLICY_VALUE_LABEL.REMAINING);
    expect(formatGroupMonthFieldValue("dueDay", null)).toBe("غير محدد");
    expect(formatGroupMonthFieldValue("dueDay", 5)).toContain("يوم");
  });
});
