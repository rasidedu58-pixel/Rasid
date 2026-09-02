import { STANDARD_PLANS, type BillingCycle, type PaymentInstructions, type BillingPaymentMethod } from "@academic-precision/contracts";

/**
 * Pure builders for the manual-payment instructions + WhatsApp proof deeplink —
 * no I/O, unit-testable. Config values (InstaPay/Vodafone handles + the Rasid
 * billing WhatsApp number) are passed in; when a channel is unconfigured the
 * builder returns a business-safe "unavailable" shape (null handle / no
 * deeplink) instead of throwing.
 */

export interface BillingChannelConfig {
  instapayHandle?: string;
  vodafoneCashNumber?: string;
  billingWhatsappNumber?: string;
}

const CYCLE_AR: Record<BillingCycle, string> = { MONTHLY: "شهري", ANNUAL: "سنوي" };

/**
 * EGP display for a minor amount. Whole amounts render with no decimals
 * ("300 جنيه"); custom-plan prices that carry piastres are shown exactly
 * ("180.50 جنيه") rather than silently rounded — the payer must see the
 * amount they will actually transfer.
 */
export function formatEgpMajor(amountMinor: number): string {
  const major = amountMinor / 100;
  const text = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return `${text} جنيه`;
}

/** Normalize an Egyptian phone/handle to a wa.me international form (mirrors the web whatsappLink logic). Returns null if too short. */
export function normalizeWhatsappNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) return `20${digits.slice(1)}`;
  return digits;
}

export function planNameAr(planCode: string): string {
  return planCode in STANDARD_PLANS ? STANDARD_PLANS[planCode as keyof typeof STANDARD_PLANS].nameAr : planCode;
}

export interface InstructionInput {
  method: BillingPaymentMethod;
  planCode: string;
  billingCycle: BillingCycle;
  amountMinor: number;
  currencyCode: string;
  humanCode: string;
}

export function buildPaymentInstructions(config: BillingChannelConfig, input: InstructionInput): PaymentInstructions {
  const payToHandle = input.method === "INSTAPAY" ? config.instapayHandle ?? null : config.vodafoneCashNumber ?? null;

  const normalized = config.billingWhatsappNumber ? normalizeWhatsappNumber(config.billingWhatsappNumber) : null;
  let deeplink: string | null = null;
  if (normalized) {
    const message = [
      "السلام عليكم، قمت بدفع اشتراك راصد.",
      `الباقة: ${planNameAr(input.planCode)}`,
      `الدورة: ${CYCLE_AR[input.billingCycle]}`,
      `المبلغ: ${formatEgpMajor(input.amountMinor)}`,
      `كود العملية: ${input.humanCode}`,
    ].join("\n");
    deeplink = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  }

  return {
    method: input.method,
    payToHandle,
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    humanCode: input.humanCode,
    whatsapp: { available: deeplink !== null, deeplink },
  };
}
