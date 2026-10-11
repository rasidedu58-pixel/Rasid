import { buildPaymentInstructions, formatEgpMajor, normalizeWhatsappNumber, planNameAr } from "./payment-instructions";

describe("payment instructions builder", () => {
  const fullConfig = {
    instapayHandle: "rasid@instapay",
    vodafoneCashNumber: "01000000000",
    billingWhatsappNumber: "01000000009",
  };
  const input = { method: "INSTAPAY" as const, planCode: "PROFESSIONAL", billingCycle: "MONTHLY" as const, amountMinor: 30000, currencyCode: "EGP", humanCode: "RSD-A7K29" };

  it("returns the correct pay-to handle per method", () => {
    expect(buildPaymentInstructions(fullConfig, { ...input, method: "INSTAPAY" }).payToHandle).toBe("rasid@instapay");
    expect(buildPaymentInstructions(fullConfig, { ...input, method: "VODAFONE_CASH" }).payToHandle).toBe("01000000000");
  });

  it("builds a wa.me deeplink whose prefilled message embeds the plan, amount, and RSD code", () => {
    const out = buildPaymentInstructions(fullConfig, input);
    expect(out.whatsapp.available).toBe(true);
    expect(out.whatsapp.deeplink).toContain("https://wa.me/201000000009"); // 0-prefixed 11-digit → +20
    const decoded = decodeURIComponent(out.whatsapp.deeplink!);
    expect(decoded).toContain("RSD-A7K29");
    expect(decoded).toContain("احترافي"); // PROFESSIONAL nameAr
    expect(decoded).toContain("300 جنيه"); // 30000 minor → 300 EGP
    expect(decoded).toContain("شهري");
  });

  it("degrades safely when the billing WhatsApp number is unconfigured", () => {
    const out = buildPaymentInstructions({ instapayHandle: "x@y" }, input);
    expect(out.whatsapp.available).toBe(false);
    expect(out.whatsapp.deeplink).toBeNull();
  });

  it("returns a null pay-to handle when that channel is unconfigured (no crash)", () => {
    expect(buildPaymentInstructions({ billingWhatsappNumber: "01555555555" }, input).payToHandle).toBeNull();
  });

  it("normalizeWhatsappNumber handles local, 00-intl, and short inputs", () => {
    expect(normalizeWhatsappNumber("01000000000")).toBe("201000000000"); // 0-prefixed 11-digit → +20
    expect(normalizeWhatsappNumber("00201000000000")).toBe("201000000000"); // 00-intl → strip 00
    expect(normalizeWhatsappNumber("123")).toBeNull();
  });

  it("formatEgpMajor renders whole EGP; planNameAr maps standard codes", () => {
    expect(formatEgpMajor(30000)).toBe("300 جنيه");
    expect(planNameAr("BUSINESS_PLUS")).toBe("أعمال بلس");
  });

  it("formatEgpMajor shows piastres exactly for a non-whole custom price (never silently rounded)", () => {
    // A custom-plan price of 180.50 EGP must not display as "181 جنيه" in the
    // payment instructions — the payer must see the amount they will transfer.
    expect(formatEgpMajor(18050)).toBe("180.50 جنيه");
    expect(formatEgpMajor(18000)).toBe("180 جنيه"); // whole → no decimals
    expect(formatEgpMajor(18010)).toBe("180.10 جنيه"); // trailing zero kept to 2 dp
  });
});

/**
 * Channel availability is a SERVER fact. The screen used to offer InstaPay
 * and Vodafone Cash unconditionally and only admit «قناة الدفع غير متاحة»
 * after the request was created — the user had already committed to a
 * channel that cannot receive money. These pin the shape the list endpoint
 * now returns so the UI can disable a channel before the choice.
 */
describe("transfer-channel availability", () => {
  const input = {
    method: "INSTAPAY" as const,
    planCode: "PROFESSIONAL",
    billingCycle: "MONTHLY" as const,
    amountMinor: 30000,
    currencyCode: "EGP",
    humanCode: "RSD-0001",
  };

  it("an unconfigured channel yields a null handle — never a fabricated one", () => {
    const ins = buildPaymentInstructions({}, input);
    expect(ins.payToHandle).toBeNull();
    expect(ins.whatsapp.available).toBe(false);
    expect(ins.whatsapp.deeplink).toBeNull();
  });

  it("each method reads its OWN configured handle, independently", () => {
    const config = { instapayHandle: "rasid@instapay", vodafoneCashNumber: "01000000000" };
    expect(buildPaymentInstructions(config, input).payToHandle).toBe("rasid@instapay");
    expect(buildPaymentInstructions(config, { ...input, method: "VODAFONE_CASH" }).payToHandle).toBe("01000000000");
  });

  it("one configured channel does not make the other look available", () => {
    const onlyInstapay = { instapayHandle: "rasid@instapay" };
    expect(buildPaymentInstructions(onlyInstapay, input).payToHandle).toBe("rasid@instapay");
    expect(buildPaymentInstructions(onlyInstapay, { ...input, method: "VODAFONE_CASH" }).payToHandle).toBeNull();
  });

  it("the proof deeplink carries the reference code the reviewer matches on", () => {
    const ins = buildPaymentInstructions({ instapayHandle: "x@y", billingWhatsappNumber: "01000000000" }, input);
    expect(ins.whatsapp.available).toBe(true);
    expect(decodeURIComponent(ins.whatsapp.deeplink!)).toContain("RSD-0001");
  });
});
