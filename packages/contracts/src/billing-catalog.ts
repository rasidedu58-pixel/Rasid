import type { SubscriptionStateDto } from "./billing";

/**
 * Billing Plan Catalog — the single SOURCE OF TRUTH for Rasid's commercial
 * plans (Billing Engine, Phase 1). Pure, deterministic, no DB access —
 * mirrors the `entitlement-matrix.ts` convention so it is independently
 * unit-testable and shared verbatim by apps/api (enforcement/pricing) and
 * apps/web (pricing page / customer billing).
 *
 * Two prices, two owners — kept deliberately separate (mandatory amendment 1):
 *
 *   • The CATALOG (this file) is the OFFICIAL, current sell price. Editing a
 *     price here changes what NEW customers are quoted — and MUST bump
 *     `PLAN_PRICE_VERSION`.
 *   • A SUBSCRIPTION stores its OWN commercial snapshot
 *     (`current_price_minor` / `price_currency_code` / `plan_price_version`)
 *     locked at the moment a billing action ran. A catalog edit therefore
 *     NEVER silently re-prices an existing customer on deploy; renewals /
 *     upgrades decide explicitly which price becomes effective (see the
 *     "price/version behavior" section of the Phase-1 report).
 *
 * Money is integer MINOR units (piastres) everywhere — never a float
 * (ADR-022). 100 EGP = 10000. V1 is MONTHLY-only — no annual cycle is sold
 * (commercial policy: MONTHLY ONLY). `BILLING_CYCLES` still lists `ANNUAL`
 * ONLY so historical/legacy rows parse on read; nothing new is ever annual.
 *
 * Trial is intentionally NOT a sellable plan (it is a near-PROFESSIONAL
 * capacity grant while `state = 'TRIAL'`), and CUSTOM has NO catalog price
 * (its capacity + price live on the subscription / its offer).
 */

/** Bump ONLY when an official catalog price changes. Existing subscriptions keep their own locked `planPriceVersion`; a catalog edit never re-prices a current customer (amendment 1). */
export const PLAN_PRICE_VERSION = 1;

/** ISO-4217. V1 is EGP-only. */
export const BILLING_CURRENCY = "EGP";

export const STANDARD_PLAN_CODES = ["STARTER", "GROWTH", "PROFESSIONAL", "ADVANCED", "BUSINESS", "BUSINESS_PLUS"] as const;
export type StandardPlanCode = (typeof STANDARD_PLAN_CODES)[number];

export const PLAN_CODES = [...STANDARD_PLAN_CODES, "CUSTOM"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

/**
 * Retained cycle vocabulary. `ANNUAL` remains ONLY for historical read/parse
 * compatibility (a handful of legacy/test rows carry it); it is NOT sellable —
 * see `CREATABLE_BILLING_CYCLES`. No trusted flow ever creates an annual row.
 */
export const BILLING_CYCLES = ["MONTHLY", "ANNUAL"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** The cycles a NEW subscription/renewal/upgrade/offer may be created with. V1 commercial policy: MONTHLY ONLY. */
export const CREATABLE_BILLING_CYCLES = ["MONTHLY"] as const;
export type CreatableBillingCycle = (typeof CREATABLE_BILLING_CYCLES)[number];

/** True for a cycle a trusted creation flow may accept. Everything else (i.e. ANNUAL) is rejected at the trust boundary — never silently converted. */
export function isCreatableBillingCycle(cycle: string): cycle is CreatableBillingCycle {
  return cycle === "MONTHLY";
}

export interface StandardPlan {
  code: StandardPlanCode;
  nameAr: string;
  /** Marketing badge — NOT "الأكثر اختيارًا/مبيعًا" (no data backs that); PROFESSIONAL is "الأنسب لمعظم المدرّسين". */
  badgeAr: string | null;
  /** Max UNIQUE active students (a student in N groups counts once) allowed in the workspace's current operational month. */
  maxActiveStudents: number;
  /** Max ACTIVE non-owner team members. The Owner is never counted. */
  maxTeamMembers: number;
  /** The official monthly sell price (minor units). V1 is MONTHLY-only — there is no annual price. */
  monthlyPriceMinor: number;
}

/**
 * The six standard, publicly-priced plans (product decision — capacity is the
 * sold unit, never "price per student"). Groups / sessions / storage are
 * unlimited; students + team capacity are the only levers.
 */
export const STANDARD_PLANS: Record<StandardPlanCode, StandardPlan> = {
  STARTER: { code: "STARTER", nameAr: "بداية", badgeAr: null, maxActiveStudents: 100, maxTeamMembers: 0, monthlyPriceMinor: 10000 },
  GROWTH: { code: "GROWTH", nameAr: "نمو", badgeAr: null, maxActiveStudents: 250, maxTeamMembers: 1, monthlyPriceMinor: 18000 },
  PROFESSIONAL: { code: "PROFESSIONAL", nameAr: "احترافي", badgeAr: "الأنسب لمعظم المدرّسين", maxActiveStudents: 500, maxTeamMembers: 2, monthlyPriceMinor: 30000 },
  ADVANCED: { code: "ADVANCED", nameAr: "متقدم", badgeAr: null, maxActiveStudents: 1000, maxTeamMembers: 5, monthlyPriceMinor: 45000 },
  BUSINESS: { code: "BUSINESS", nameAr: "أعمال", badgeAr: null, maxActiveStudents: 2000, maxTeamMembers: 10, monthlyPriceMinor: 70000 },
  BUSINESS_PLUS: { code: "BUSINESS_PLUS", nameAr: "أعمال بلس", badgeAr: null, maxActiveStudents: 3000, maxTeamMembers: 15, monthlyPriceMinor: 90000 },
};

/** Ordered list (STARTER → BUSINESS_PLUS) for rendering. */
export const STANDARD_PLAN_LIST: readonly StandardPlan[] = STANDARD_PLAN_CODES.map((code) => STANDARD_PLANS[code]);

/** Trial capacity — near-PROFESSIONAL, applied while `state = 'TRIAL'` (no plan_code). Not a sellable plan. */
export const TRIAL_LIMITS = { maxActiveStudents: 500, maxTeamMembers: 2 } as const;

/**
 * The largest standard plan (BUSINESS_PLUS) covers exactly this many active
 * students. A workspace is CUSTOM-only when it needs STRICTLY MORE — i.e. 3001+.
 * 3000 itself is served by BUSINESS_PLUS, never CUSTOM.
 */
export const MAX_STANDARD_PLAN_STUDENTS = 3000;

export interface EffectiveLimits {
  maxActiveStudents: number;
  maxTeamMembers: number;
}

/**
 * Why `resolvePlanLimits` could not produce limits:
 *   • UNMAPPED_LEGACY_SUBSCRIPTION — a non-TRIAL subscription with no plan_code.
 *     These are pre-Billing-Engine rows (or a data bug). We refuse to invent a
 *     commercial allowance for them: they must be surfaced and mapped BEFORE any
 *     enforcement runs, never silently treated as a 500-student trial.
 *   • CUSTOM_LIMITS_MISSING — a CUSTOM subscription missing its stored limits
 *     (the DB CHECK makes this impossible; the throw guards genuinely corrupt data).
 */
export type PlanLimitsResolutionFailure = "UNMAPPED_LEGACY_SUBSCRIPTION" | "CUSTOM_LIMITS_MISSING";

export class PlanLimitsResolutionError extends Error {
  constructor(
    public readonly reason: PlanLimitsResolutionFailure,
    public readonly subscriptionState: SubscriptionStateDto,
  ) {
    super(`Cannot resolve plan limits (${reason}) for subscription state ${subscriptionState}.`);
    this.name = "PlanLimitsResolutionError";
  }
}

export interface ResolvePlanLimitsInput {
  subscriptionState: SubscriptionStateDto;
  /** NULL only for a live TRIAL; a standard code or 'CUSTOM' once a plan exists. Any OTHER state with NULL is a legacy/unmapped row. */
  planCode: PlanCode | null;
  /** Set (DB-guaranteed non-null) ONLY when planCode = 'CUSTOM'. */
  customMaxActiveStudents: number | null;
  customMaxTeamMembers: number | null;
}

/**
 * Effective numeric limits for a subscription. Pure. Never fabricates a
 * commercial allowance: the ONLY state that yields limits without a plan_code is
 * a live TRIAL. Any other state lacking a plan_code throws
 * `PlanLimitsResolutionError("UNMAPPED_LEGACY_SUBSCRIPTION")` so legacy rows are
 * detected explicitly before enforcement — there is no silent trial fallback.
 */
export function resolvePlanLimits(input: ResolvePlanLimitsInput): EffectiveLimits {
  // 1) A live trial is the ONLY state that carries capacity without a plan_code.
  if (input.subscriptionState === "TRIAL") {
    return { maxActiveStudents: TRIAL_LIMITS.maxActiveStudents, maxTeamMembers: TRIAL_LIMITS.maxTeamMembers };
  }

  // 2) A CUSTOM subscription carries its capacity on the row (DB CHECK guarantees
  //    both custom_* non-null for CUSTOM — this throw only fires on corrupt data).
  if (input.planCode === "CUSTOM") {
    if (input.customMaxActiveStudents == null || input.customMaxTeamMembers == null) {
      throw new PlanLimitsResolutionError("CUSTOM_LIMITS_MISSING", input.subscriptionState);
    }
    return { maxActiveStudents: input.customMaxActiveStudents, maxTeamMembers: input.customMaxTeamMembers };
  }

  // 3) A standard plan — limits from the catalog (retained for display even when
  //    the subscription has since EXPIRED).
  if (input.planCode != null) {
    const plan = STANDARD_PLANS[input.planCode];
    return { maxActiveStudents: plan.maxActiveStudents, maxTeamMembers: plan.maxTeamMembers };
  }

  // 4) Non-TRIAL with no plan_code = a pre-Billing-Engine / unmapped subscription.
  //    Refuse to assume any commercial allowance — surface it loudly.
  throw new PlanLimitsResolutionError("UNMAPPED_LEGACY_SUBSCRIPTION", input.subscriptionState);
}

export interface CatalogPrice {
  amountMinor: number;
  currency: string;
  /** The catalog price generation this amount came from — stored on the subscription so a later catalog edit never re-prices this customer. */
  planPriceVersion: number;
}

/**
 * The OFFICIAL current catalog price for a standard plan, tagged with the
 * current `PLAN_PRICE_VERSION`. V1 is MONTHLY-only: a non-monthly cycle has no
 * catalog price → `null` (so no trusted flow can ever price an annual row).
 * CUSTOM also has no catalog price → `null` (negotiated on the offer). This is
 * what a NEW subscription or an explicit re-price locks into its own snapshot;
 * it is never read to display an existing customer's price.
 */
export function resolveCatalogPrice(planCode: PlanCode, cycle: BillingCycle): CatalogPrice | null {
  if (planCode === "CUSTOM") return null;
  if (cycle !== "MONTHLY") return null; // MONTHLY-only — annual is not sellable
  const plan = STANDARD_PLANS[planCode];
  return { amountMinor: plan.monthlyPriceMinor, currency: BILLING_CURRENCY, planPriceVersion: PLAN_PRICE_VERSION };
}

/** True when a workspace of this active-student count can only be served by a CUSTOM plan (strictly more than the largest standard plan — 3001+). */
export function requiresCustomPlan(activeStudents: number): boolean {
  return activeStudents > MAX_STANDARD_PLAN_STUDENTS;
}

// ---------------------------------------------------------------------------
// Renewal pricing policy (contract only — no renewal flow is implemented here).
//
// Grandfathering is a POLICY, not a law baked into a resolver. A renewal must
// state explicitly which price becomes effective for the next period, so the
// behaviour can change later WITHOUT a schema change (the snapshot columns
// current_price_minor / price_currency_code / plan_price_version already store
// everything KEEP_CURRENT_PRICE needs).
//
//   • KEEP_CURRENT_PRICE       — honour the customer's locked snapshot (V1 DEFAULT).
//   • USE_CURRENT_CATALOG_PRICE — re-price to the current official catalog price.
//
// CUSTOM always renews at its agreed snapshot price regardless of policy — a
// negotiated deal only changes through an explicit commercial action (a new
// custom offer), never implicitly on renewal.
// ---------------------------------------------------------------------------

export const RENEWAL_PRICE_POLICIES = ["KEEP_CURRENT_PRICE", "USE_CURRENT_CATALOG_PRICE"] as const;
export type RenewalPricePolicy = (typeof RENEWAL_PRICE_POLICIES)[number];

/** V1 default: existing customers keep their locked price on renewal (a catalog edit never re-prices them). */
export const DEFAULT_RENEWAL_PRICE_POLICY: RenewalPricePolicy = "KEEP_CURRENT_PRICE";

export type RenewalPriceResolutionFailure = "MISSING_PRICE_SNAPSHOT" | "NO_CATALOG_PRICE";

export class RenewalPriceResolutionError extends Error {
  constructor(public readonly reason: RenewalPriceResolutionFailure) {
    super(`Cannot resolve renewal price (${reason}).`);
    this.name = "RenewalPriceResolutionError";
  }
}

export interface ResolveRenewalPriceInput {
  policy: RenewalPricePolicy;
  planCode: PlanCode | null;
  billingCycle: BillingCycle | null;
  /** The subscription's currently locked commercial snapshot. */
  currentPriceMinor: number | null;
  currentPriceCurrency: string | null;
  currentPlanPriceVersion: number | null;
}

export interface ResolvedRenewalPrice {
  amountMinor: number;
  currency: string;
  /** The catalog generation this price came from — NULL for a hand-priced CUSTOM snapshot. */
  planPriceVersion: number | null;
  /** Provenance of the price that will be charged next period. */
  source: "SUBSCRIPTION_SNAPSHOT" | "CURRENT_CATALOG";
}

/**
 * The explicit price for the NEXT renewal period. Pure. A renewal flow (later
 * phase) calls this with a chosen policy instead of assuming grandfathering.
 * CUSTOM always keeps its snapshot. KEEP_CURRENT_PRICE returns the locked
 * snapshot (throws if none). USE_CURRENT_CATALOG_PRICE re-prices from the
 * catalog (throws if the plan has no catalog price, e.g. CUSTOM).
 */
export function resolveRenewalPrice(input: ResolveRenewalPriceInput): ResolvedRenewalPrice {
  const snapshot = (): ResolvedRenewalPrice => {
    if (input.currentPriceMinor == null || input.currentPriceCurrency == null) {
      throw new RenewalPriceResolutionError("MISSING_PRICE_SNAPSHOT");
    }
    return {
      amountMinor: input.currentPriceMinor,
      currency: input.currentPriceCurrency,
      planPriceVersion: input.currentPlanPriceVersion,
      source: "SUBSCRIPTION_SNAPSHOT",
    };
  };

  // A negotiated CUSTOM deal only ever changes through an explicit commercial
  // action, never implicitly on renewal — always keep its snapshot.
  if (input.planCode === "CUSTOM") return snapshot();

  if (input.policy === "KEEP_CURRENT_PRICE") return snapshot();

  // USE_CURRENT_CATALOG_PRICE
  if (input.planCode == null || input.billingCycle == null) {
    throw new RenewalPriceResolutionError("NO_CATALOG_PRICE");
  }
  const catalog = resolveCatalogPrice(input.planCode, input.billingCycle);
  if (catalog == null) throw new RenewalPriceResolutionError("NO_CATALOG_PRICE");
  return { amountMinor: catalog.amountMinor, currency: catalog.currency, planPriceVersion: catalog.planPriceVersion, source: "CURRENT_CATALOG" };
}

// ---------------------------------------------------------------------------
// Capacity threshold detection (Phase 2 — DETECTION ONLY, reusable & pure).
//
// A soft signal for "approaching your plan limit". The emit side (a notification
// via the existing outbox/notifications infra) is intentionally NOT built here;
// this only decides WHICH band a (usage, limit) pair has crossed, and gives a
// stable dedup key so a workspace gets AT MOST ONE notification per period per
// band — never one per enrollment after 90%.
// ---------------------------------------------------------------------------

export const CAPACITY_THRESHOLD_BANDS = [90, 95, 100] as const;
export type CapacityThresholdBand = (typeof CAPACITY_THRESHOLD_BANDS)[number];

/** The highest band a usage/limit pair has crossed, or null below 90%. Pure. */
export function resolveCapacityThresholdBand(usage: number, limit: number): CapacityThresholdBand | null {
  if (limit <= 0) return null;
  if (usage >= limit) return 100;
  const pct = (usage / limit) * 100;
  if (pct >= 95) return 95;
  if (pct >= 90) return 90;
  return null;
}

/**
 * Dedup key for a capacity-threshold notification: at most one per
 * (workspace, kind, period, band). `periodKey` = the current operating-month id
 * for STUDENTS, a stable constant (e.g. "team") for TEAM. The workspace scoping
 * comes from the notification row's own workspace_id, so it is not repeated here.
 */
export function capacityThresholdDedupKey(kind: "STUDENTS" | "TEAM", periodKey: string, band: CapacityThresholdBand): string {
  return `capacity:${kind}:${periodKey}:${band}`;
}
