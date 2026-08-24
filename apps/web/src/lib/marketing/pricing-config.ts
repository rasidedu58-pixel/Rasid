/**
 * Central, editable pricing configuration — Phase 12.
 *
 * Marketing-only. The real backend billing model (Phase 8) supports
 * exactly ONE Paddle price (`PADDLE_PRICE_ID`) and ONE subscription per
 * workspace — there is no plan/tier/capacity concept anywhere in the
 * schema or contracts (verified before writing this file). Every tier's
 * CTA therefore starts the SAME 14-day trial via the real signup flow;
 * none of them are wired to a distinct Paddle price. This is a deliberate,
 * documented, temporary state — see `docs/RELEASE_GATES.md`'s "Commercial
 * Billing Gap" entry — not a bug and not a dark pattern: nothing here
 * claims a specific price is being charged today, only what the plan
 * WILL cost once multi-tier billing exists.
 *
 * To change pricing later: edit this file only. No page/component needs
 * to change.
 */

export interface PricingPlan {
  id: string;
  /** Short evocative label shown above the capacity — never implies a final/committed price on its own. */
  tagline: string;
  /** The actual sold unit, per explicit product decision: capacity, never "price per student". */
  studentCapacityLabel: string;
  /** Null for the custom/contact-us tier (no fixed monthly price exists). */
  monthlyPriceEGP: number | null;
  highlighted?: boolean;
  /** True only for the top "contact us" tier — routes to Support instead of Signup. */
  isCustom?: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  { id: "up-to-50", tagline: "للبداية", studentCapacityLabel: "حتى 50 طالبًا", monthlyPriceEGP: 99 },
  { id: "up-to-100", tagline: "للنمو", studentCapacityLabel: "حتى 100 طالب", monthlyPriceEGP: 179 },
  { id: "up-to-250", tagline: "الأكثر اختيارًا", studentCapacityLabel: "حتى 250 طالبًا", monthlyPriceEGP: 299, highlighted: true },
  { id: "up-to-500", tagline: "للمجموعات الكبيرة", studentCapacityLabel: "حتى 500 طالب", monthlyPriceEGP: 449 },
  { id: "up-to-1000", tagline: "للنطاق الموسّع", studentCapacityLabel: "حتى 1000 طالب", monthlyPriceEGP: 699 },
  { id: "custom", tagline: "تسعير خاص", studentCapacityLabel: "أكثر من 1000 طالب", monthlyPriceEGP: null, isCustom: true },
];

export const TRIAL_DAYS = 14;
