import { describe, expect, it } from "vitest";
import { whatsappHref } from "../lib/whatsapp";

describe("whatsappHref — phone → wa.me (Egyptian country-code normalization)", () => {
  it("normalizes a local Egyptian 0-prefixed 11-digit number to international (the reported case)", () => {
    // 01227958232 used to be sent as-is → WhatsApp: "رمز الدولة غير صحيح".
    expect(whatsappHref("01227958232")).toBe("https://wa.me/201227958232");
  });

  it("tolerates spaces/dashes and accepts 00-prefixed / already-international forms", () => {
    expect(whatsappHref("012 2795 8232")).toBe("https://wa.me/201227958232");
    expect(whatsappHref("011-2345-6789")).toBe("https://wa.me/201123456789");
    expect(whatsappHref("00201227958232")).toBe("https://wa.me/201227958232");
    expect(whatsappHref("+201227958232")).toBe("https://wa.me/201227958232");
    expect(whatsappHref("201227958232")).toBe("https://wa.me/201227958232");
  });

  it("appends an encoded prefilled message when provided", () => {
    expect(whatsappHref("01227958232", "مرحبا")).toBe(`https://wa.me/201227958232?text=${encodeURIComponent("مرحبا")}`);
  });

  it("returns null for empty / too-short / missing input", () => {
    expect(whatsappHref(null)).toBeNull();
    expect(whatsappHref(undefined)).toBeNull();
    expect(whatsappHref("")).toBeNull();
    expect(whatsappHref("123")).toBeNull();
  });
});
