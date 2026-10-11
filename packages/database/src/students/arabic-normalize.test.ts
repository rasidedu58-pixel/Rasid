import { describe, expect, it } from "vitest";
import { normalizeArabicName, normalizePhone, normalizePhoneSearchQuery } from "./arabic-normalize";

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

/**
 * The guardian-phone search bug: the number was stored and the teacher typed
 * it, yet search returned nothing — because the lookup compared the query to
 * `guardians.normalized_phone` with `=`. These pin the reduction that makes
 * every spelling of one number collapse to the same digit run, which the
 * repository then matches as a substring.
 */
describe("normalizePhoneSearchQuery", () => {
  const NATIONAL = "1001234567"; // 0100 123 4567 without its trunk zero

  it("reduces every spelling of the same Egyptian number to the same digits", () => {
    expect(normalizePhoneSearchQuery("01001234567")).toBe(NATIONAL);
    expect(normalizePhoneSearchQuery("+201001234567")).toBe(NATIONAL);
    expect(normalizePhoneSearchQuery("00201001234567")).toBe(NATIONAL);
    expect(normalizePhoneSearchQuery("201001234567")).toBe(NATIONAL);
    expect(normalizePhoneSearchQuery("1001234567")).toBe(NATIONAL);
  });

  it("is a substring of the STORED form for both local and international storage", () => {
    // `normalizePhone` is the storage form — this is the property the
    // repository's LIKE '%…%' relies on.
    expect(normalizePhone("0100 123 4567")).toContain(normalizePhoneSearchQuery("+20 100 123 4567"));
    expect(normalizePhone("+20 100 123 4567")).toContain(normalizePhoneSearchQuery("01001234567"));
  });

  it("tolerates spaces, dashes, parentheses and Arabic-Indic digits", () => {
    expect(normalizePhoneSearchQuery("٠١٠٠-١٢٣-٤٥٦٧")).toBe(NATIONAL);
    expect(normalizePhoneSearchQuery("(0100) 123 4567")).toBe(NATIONAL);
  });

  it("leaves a PARTIAL number alone so the last/first few digits still match", () => {
    expect(normalizePhoneSearchQuery("4567")).toBe("4567");
    expect(normalizePhoneSearchQuery("123 4567")).toBe("1234567");
    expect(normalizePhone("01001234567")).toContain(normalizePhoneSearchQuery("4567"));
  });

  it("never mutilates a short local number that merely begins with 20", () => {
    // Only treated as a country code when a full national number follows.
    expect(normalizePhoneSearchQuery("2012345")).toBe("2012345");
  });

  it("keeps a lone zero rather than reducing the query to nothing", () => {
    expect(normalizePhoneSearchQuery("0")).toBe("0");
  });
});
