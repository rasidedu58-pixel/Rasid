import { describe, expect, it } from "vitest";
import { normalizeArabicName, normalizePhone } from "./arabic-normalize";

describe("normalizeArabicName", () => {
  it("normalizes alef variants (أ/إ/آ) to bare alef", () => {
    expect(normalizeArabicName("أحمد")).toBe("احمد");
    expect(normalizeArabicName("إبراهيم")).toBe("ابراهيم");
    expect(normalizeArabicName("آدم")).toBe("ادم");
  });

  it("normalizes alef maksura (ى) to yeh (ي)", () => {
    expect(normalizeArabicName("مصطفى")).toBe("مصطفي");
  });

  it("strips tatweel (ـ)", () => {
    expect(normalizeArabicName("محـــمد")).toBe("محمد");
  });

  it("strips Arabic diacritics", () => {
    expect(normalizeArabicName("مُحَمَّد")).toBe("محمد");
  });

  it("normalizes Arabic-Indic digits to Western digits", () => {
    expect(normalizeArabicName("طالب ٤٥")).toBe("طالب 45");
  });

  it("collapses multiple whitespace and trims", () => {
    expect(normalizeArabicName("  أحمد    محمد  ")).toBe("احمد محمد");
  });

  it("combined realistic example: diacritics + alef variants + extra whitespace at once", () => {
    expect(normalizeArabicName("  إسْـلَام   أَحْمَد  ")).toBe("اسلام احمد");
  });

  it("leaves an already-normalized name unchanged", () => {
    expect(normalizeArabicName("سارة علي")).toBe("سارة علي");
  });
});

describe("normalizePhone", () => {
  it("strips spaces, dashes, parentheses, and a leading plus", () => {
    expect(normalizePhone("+20 (10) 123-4567")).toBe("20101234567");
  });

  it("keeps only digits", () => {
    expect(normalizePhone("+20 10 1234 5678")).toBe("201012345678");
  });

  it("converts Arabic-Indic digits to Western before stripping", () => {
    expect(normalizePhone("٠١٠ ١٢٣ ٤٥٦٧")).toBe("0101234567");
  });

  it("normalizes an already-Western digit string identically to its Arabic-Indic equivalent", () => {
    expect(normalizePhone("010 123 4567")).toBe(normalizePhone("٠١٠ ١٢٣ ٤٥٦٧"));
  });
});
