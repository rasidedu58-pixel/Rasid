/**
 * Marketing pricing — Billing Engine, Phase 6 pricing-consistency.
 *
 * Derives ENTIRELY from the billing catalog (`STANDARD_PLAN_LIST` in
 * `@academic-precision/contracts`), which is the single source of truth for
 * plan capacity + price. No duplicated/stale price constants live here anymore.
 *
 * V1 commercial policy: MONTHLY ONLY — there is no annual price, no annual
 * toggle, and no "pay-10-get-12" wording anywhere on the marketing surface.
 *
 * COPY POLICY — audited against real code (billing-catalog.ts + entitlement-
 * matrix.ts). The catalog says explicitly: "Groups / sessions / storage are
 * unlimited; students + team capacity are the only levers", and the
 * entitlement matrix moves all 4 capabilities together per SUBSCRIPTION
 * STATE, not per plan. So Pricing Cards NEVER carry per-plan feature bullets
 * (that would falsely imply a lower plan lacks a capability the code
 * actually ships to every plan). Instead:
 *   • One shared "كل الخطط تشمل" block (`SHARED_CAPABILITIES`, rendered
 *     above the grid) lists the real product surface — once.
 *   • Each card carries only the actual per-plan differences: name,
 *     positioning, capacity, price, team-seat count, CTA. Nothing else.
 *
 * To change pricing later: edit the catalog in contracts — this file follows.
 */
import { STANDARD_PLAN_LIST } from "@academic-precision/contracts";

export interface PricingPlan {
  id: string;
  /** Short evocative label shown above the capacity — never a price claim on its own. */
  tagline: string;
  /** One-line persona/positioning: WHO this plan best fits — not a feature claim. */
  positioning: string;
  /** The actual sold unit: capacity, never "price per student". */
  studentCapacityLabel: string;
  /** How many extra team seats the plan carries — natural Arabic per count, NULL for custom. */
  teamSeatsLabel: string | null;
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

/** Evocative one-word taglines per catalog code — kept short so the persona line does the heavier lifting. */
const TAGLINES: Record<string, string> = {
  STARTER: "للبداية",
  GROWTH: "للنمو",
  PROFESSIONAL: "للاحتراف",
  ADVANCED: "للتوسّع",
  BUSINESS: "للأعمال",
  BUSINESS_PLUS: "للمؤسسات",
};

/** Short persona headline for each plan — never a feature claim. */
const POSITIONINGS: Record<string, string> = {
  STARTER: "للمدرس الذي يبدأ في تنظيم طلابه",
  GROWTH: "لمن زاد عدد طلابه ومجموعاته",
  PROFESSIONAL: "للمدرس الذي يدير عمله بصورة متكاملة",
  ADVANCED: "لأحجام تشغيل أكبر",
  BUSINESS: "لفرق أكبر ومجموعات كثيرة",
  BUSINESS_PLUS: "للأحجام الكبيرة جدًا",
};

/**
 * Natural-Arabic label for the team-seat count.
 *
 * PRECISION (matches the code, not the pitch):
 *  • `maxTeamMembers` is the number of ACTIVE **non-owner** members allowed —
 *    the Owner is NEVER counted (billing-catalog.ts:69 verbatim, and
 *    packages/database/src/billing/capacity.ts:202 "the Owner is never
 *    counted; PENDING invitations are not members"). So the label reads
 *    "إضافي/ة" / "إلى جانبك" — seats are ADDITIONAL to the Owner.
 *  • Enforcement fires at ACCEPT/activation (invitations.repository.ts:193
 *    and permissions.repository.ts:205) — a PENDING invitation adds nothing.
 *
 * Wording per owner review: readable Arabic, no forced dual form.
 */
function teamSeatsLabelFor(count: number): string {
  if (count === 0) return "بدون مقاعد فريق إضافية — الحساب لك وحدك";
  if (count === 1) return "مقعد فريق إضافي إلى جانبك";
  if (count === 2) return "مقعدان إضافيان للفريق";
  if (count <= 10) return `${count} مقاعد إضافية للفريق`;
  return `${count} مقعدًا إضافيًا للفريق`;
}

export const PRICING_PLANS: PricingPlan[] = [
  ...STANDARD_PLAN_LIST.map((p) => ({
    id: p.code,
    tagline: TAGLINES[p.code] ?? p.nameAr,
    positioning: POSITIONINGS[p.code] ?? p.nameAr,
    studentCapacityLabel: `حتى ${p.maxActiveStudents} طالب`,
    teamSeatsLabel: teamSeatsLabelFor(p.maxTeamMembers),
    maxActiveStudents: p.maxActiveStudents,
    monthlyPriceEGP: p.monthlyPriceMinor / 100, // MONTHLY-only, from the catalog
    badge: p.badgeAr,
    highlighted: p.badgeAr !== null,
  })),
  {
    id: "custom",
    tagline: "باقة مخصّصة",
    positioning: "لأكثر من 3000 طالب — نصمم لك الباقة",
    studentCapacityLabel: "أكثر من 3000 طالب",
    teamSeatsLabel: "سعة الطلاب ومقاعد الفريق حسب احتياجك",
    maxActiveStudents: Number.POSITIVE_INFINITY,
    monthlyPriceEGP: null,
    isCustom: true,
    badge: null,
  },
];

export const TRIAL_DAYS = 14;

/**
 * Real product surface shipped in EVERY plan — the six capability families
 * present across the codebase (students/groups tables + sessions/attendance
 * + assignments/exams + attention/notifications + payments ledger + reports
 * renderers). Rendered ONCE above the pricing grid so no card falsely
 * implies a capability is plan-locked. Each label is a short chip, not a
 * marketing paragraph.
 *
 * Kept together with pricing config so any product-surface change stays
 * one-file to update.
 */
export interface SharedCapability {
  id: string;
  label: string;
}
export const SHARED_CAPABILITIES: SharedCapability[] = [
  { id: "students-groups", label: "الطلاب والمجموعات" },
  { id: "sessions-attendance", label: "الحصص والحضور" },
  { id: "assignments-exams", label: "الواجبات والاختبارات" },
  { id: "attention-alerts", label: "المتابعة والتنبيهات" },
  { id: "finance-payments", label: "المالية والمدفوعات" },
  { id: "reports-export", label: "التقارير والتصدير" },
];

/** Definitive one-liner reinforcing what actually differs between plans. */
export const SHARED_CAPABILITIES_NOTE =
  "كل أدوات راصد الأساسية متاحة في جميع الخطط — الاختلاف فقط في سعة الطلاب وعدد مقاعد الفريق.";
