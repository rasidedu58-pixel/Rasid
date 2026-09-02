/**
 * Marketing pricing — Billing Engine, Phase 6 pricing-consistency.
 *
 * Derives ENTIRELY from the billing catalog (`STANDARD_PLAN_LIST` in
 * `@academic-precision/contracts`), which is the single source of truth for
 * plan capacity + price. No duplicated/stale price constants live here anymore.
 *
 * V1 commercial policy: MONTHLY ONLY — there is no annual price, no annual
 * toggle, and no "pay-10-get-12" wording anywhere on the marketing surface. The
 * only badge is the catalog's own (PROFESSIONAL → "الأنسب لمعظم المدرّسين"); no
 * unverifiable popularity/best-seller claim is used.
 *
 * To change pricing later: edit the catalog in contracts — this file follows.
 */
import { STANDARD_PLAN_LIST } from "@academic-precision/contracts";

export interface PricingPlan {
  id: string;
  /** Short evocative label shown above the capacity — never a price claim on its own. */
  tagline: string;
  /** The actual sold unit: capacity, never "price per student". */
  studentCapacityLabel: string;
  /** Numeric capacity ceiling (Infinity for the custom/contact tier) — drives the calculator match. */
  maxActiveStudents: number;
  /** Null for the custom tier (no fixed monthly price). MONTHLY-only — never an annual price. */
  monthlyPriceEGP: number | null;
  /** The catalog badge (only PROFESSIONAL: "الأنسب لمعظم المدرّسين"), or null. */
  badge?: string | null;
  highlighted?: boolean;
  /** True only for the "أكثر من 3000 طالب" tier — routes to Support instead of Signup. */
  isCustom?: boolean;
}

/** Evocative taglines per catalog code (marketing copy; capacity + price stay catalog-sourced). */
const TAGLINES: Record<string, string> = {
  STARTER: "للبداية",
  GROWTH: "للنمو",
  PROFESSIONAL: "للاحتراف",
  ADVANCED: "للتوسّع",
  BUSINESS: "للأعمال",
  BUSINESS_PLUS: "للمؤسسات",
};

export const PRICING_PLANS: PricingPlan[] = [
  ...STANDARD_PLAN_LIST.map((p) => ({
    id: p.code,
    tagline: TAGLINES[p.code] ?? p.nameAr,
    studentCapacityLabel: `حتى ${p.maxActiveStudents} طالب`,
    maxActiveStudents: p.maxActiveStudents,
    monthlyPriceEGP: p.monthlyPriceMinor / 100, // MONTHLY-only, from the catalog
    badge: p.badgeAr,
    highlighted: p.badgeAr !== null,
  })),
  {
    id: "custom",
    tagline: "باقة مخصّصة",
    studentCapacityLabel: "أكثر من 3000 طالب — اطلب عرضًا مخصصًا",
    maxActiveStudents: Number.POSITIVE_INFINITY,
    monthlyPriceEGP: null,
    isCustom: true,
    badge: null,
  },
];

export const TRIAL_DAYS = 14;
