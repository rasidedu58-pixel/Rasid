import {
  STANDARD_PLAN_CODES,
  STANDARD_PLANS,
  type BillingCycle,
  type PlanCode,
  type StandardPlanCode,
} from "./billing-catalog";

/**
 * Plan-change math — Billing Engine, Phase 4 (UPGRADE proration + plan ordering).
 *
 * PURE + deterministic, no DB / no I/O / no floating-point money — mirrors
 * `billing-catalog.ts`. Money is integer MINOR units (ADR-022); every internal
 * calculation is BigInt integer arithmetic and the final customer charge is
 * floored to whole EGP in the CUSTOMER's favour (never a partial piastre, never
 * a rounding that overcharges).
 *
 * SCOPE (Phase 4 V1): STANDARD ↔ STANDARD only. CUSTOM never enters comparison
 * or proration here (it is out of scope for Phase 4). Cross-cycle changes
 * (monthly↔annual) are intentionally NOT priced here (see NOT_SAME_CYCLE) —
 * they carry a commercial ambiguity that must be decided before implementation.
 */

// ---------------------------------------------------------------------------
// Plan ordering / commercial comparison (STARTER < … < BUSINESS_PLUS).
// Order is derived from the single source `STANDARD_PLAN_CODES`, never string
// comparison. CUSTOM is deliberately NOT ordered — it is out of scope.
// ---------------------------------------------------------------------------

const STANDARD_PLAN_RANK: Record<StandardPlanCode, number> = STANDARD_PLAN_CODES.reduce(
  (acc, code, index) => {
    acc[code] = index;
    return acc;
  },
  {} as Record<StandardPlanCode, number>,
);

/** True for one of the six ordered standard plans (excludes CUSTOM and any junk value). */
export function isStandardPlanCode(code: unknown): code is StandardPlanCode {
  return typeof code === "string" && code in STANDARD_PLAN_RANK;
}

/**
 * -1 / 0 / +1 comparing two STANDARD plans by commercial rank. Throws on a
 * non-standard code (CUSTOM / invalid) so no caller can silently compare CUSTOM.
 */
export function compareStandardPlans(a: StandardPlanCode, b: StandardPlanCode): -1 | 0 | 1 {
  if (!isStandardPlanCode(a) || !isStandardPlanCode(b)) {
    throw new PlanChangeValidationError("INVALID_PLAN");
  }
  const ra = STANDARD_PLAN_RANK[a];
  const rb = STANDARD_PLAN_RANK[b];
  return ra < rb ? -1 : ra > rb ? 1 : 0;
}

/** A transition from → to is an UPGRADE iff both are standard and `to` ranks strictly higher (from < to). */
export function isUpgrade(from: PlanCode, to: PlanCode): boolean {
  if (!isStandardPlanCode(from) || !isStandardPlanCode(to)) return false;
  return compareStandardPlans(from, to) === -1;
}

/** A transition from → to is a DOWNGRADE iff both are standard and `to` ranks strictly lower (from > to). */
export function isDowngrade(from: PlanCode, to: PlanCode): boolean {
  if (!isStandardPlanCode(from) || !isStandardPlanCode(to)) return false;
  return compareStandardPlans(from, to) === 1;
}

export type PlanChangeValidationReason =
  | "INVALID_PLAN" // not a standard plan (CUSTOM / junk)
  | "CUSTOM_OUT_OF_SCOPE" // CUSTOM explicitly rejected in Phase 4
  | "SAME_PLAN" // target equals current
  | "NOT_AN_UPGRADE" // target is lower (use the downgrade flow)
  | "NOT_A_DOWNGRADE"; // target is higher (use the upgrade flow)

export class PlanChangeValidationError extends Error {
  constructor(public readonly reason: PlanChangeValidationReason) {
    super(`Plan change rejected: ${reason}`);
    this.name = "PlanChangeValidationError";
  }
}

/** Validate that (current → target) is a well-formed UPGRADE. Throws a typed reason otherwise. */
export function assertUpgradeTransition(current: PlanCode, target: PlanCode): asserts target is StandardPlanCode {
  if (current === "CUSTOM" || target === "CUSTOM") throw new PlanChangeValidationError("CUSTOM_OUT_OF_SCOPE");
  if (!isStandardPlanCode(current) || !isStandardPlanCode(target)) throw new PlanChangeValidationError("INVALID_PLAN");
  const cmp = compareStandardPlans(current, target);
  if (cmp === 0) throw new PlanChangeValidationError("SAME_PLAN");
  if (cmp === 1) throw new PlanChangeValidationError("NOT_AN_UPGRADE"); // current already higher
}

/** Validate that (current → target) is a well-formed DOWNGRADE. Throws a typed reason otherwise. */
export function assertDowngradeTransition(current: PlanCode, target: PlanCode): asserts target is StandardPlanCode {
  if (current === "CUSTOM" || target === "CUSTOM") throw new PlanChangeValidationError("CUSTOM_OUT_OF_SCOPE");
  if (!isStandardPlanCode(current) || !isStandardPlanCode(target)) throw new PlanChangeValidationError("INVALID_PLAN");
  const cmp = compareStandardPlans(current, target);
  if (cmp === 0) throw new PlanChangeValidationError("SAME_PLAN");
  if (cmp === -1) throw new PlanChangeValidationError("NOT_A_DOWNGRADE"); // current already lower
}

// ---------------------------------------------------------------------------
// UPGRADE proration.
//
// Business rule (spec §4): an upgrade is IMMEDIATE after payment; period_end is
// NOT changed; the customer pays only the price DIFFERENCE for the remaining
// paid-through time:
//
//   amountDue = (targetPrice - currentPriceSnapshot) × remainingTime / nominalCycle
//
//   • currentPriceSnapshot = subscription.current_price_minor  (the customer's
//     LOCKED price — NOT the current catalog price of the current plan; §8).
//   • targetPrice          = target plan's CURRENT official catalog price (§8).
//   • remainingTime        = period_end − now
//   • nominalCycle         = period_end − period_start  (the stored current cycle)
//
// EXACTNESS BOUNDARY (spec §5, §23 — this is the crux of the audit):
//   The subscription stores ONLY the current cycle [period_start, period_end]
//   and a single price snapshot. When `now` lies INSIDE that stored cycle
//   (now ≥ period_start ⇒ ratio ≤ 1), the credit for the remaining time is
//   EXACT from the stored fields alone.
//   When stacked early renewals have pushed period_start into the FUTURE
//   (now < period_start ⇒ remaining > one nominal cycle), the remaining
//   prepaid time spans MULTIPLE past cycles whose individual calendar
//   boundaries are NOT recoverable from a single snapshot (month-end clamping
//   makes backward reconstruction lossy). Rather than APPROXIMATE (spec forbids
//   it), this returns REQUIRES_PERIOD_LEDGER so the caller stops and the
//   commercial period ledger decision is made explicitly.
// ---------------------------------------------------------------------------

export interface UpgradeProrationInput {
  currentPlan: StandardPlanCode;
  targetPlan: StandardPlanCode;
  billingCycle: BillingCycle; // same-cycle upgrade only in V1
  /** The subscription's LOCKED current price for its cycle (subscription.current_price_minor). */
  currentPriceMinorSnapshot: number;
  /** Target plan's CURRENT official catalog price for the SAME cycle (server-resolved). */
  targetCatalogPriceMinor: number;
  /** Epoch ms. Stored subscription.period_start / period_end and the server's now. */
  periodStartMs: number;
  periodEndMs: number;
  nowMs: number;
}

export type UpgradeProrationResult =
  | {
      kind: "DUE";
      /** The customer charge, floored to whole EGP in the customer's favour (minor units, multiple of 100). */
      amountDueMinor: number;
      /** Informational: value of the remaining paid time at the CURRENT locked price (minor, exact-floored). */
      creditRemainingMinor: number;
      /** Informational: cost of the remaining paid time at the TARGET catalog price (minor, exact-floored). */
      targetRemainingCostMinor: number;
      /** Informational: the target plan's full nominal cycle price. */
      normalTargetPriceMinor: number;
      remainingMs: number;
      nominalCycleMs: number;
    }
  | {
      /** Difference over remaining time is ≤ 0 (e.g. negligible remaining time). No charge should be created. */
      kind: "NON_POSITIVE";
      rawDueMinor: number;
    }
  | {
      /** `now` is at/after period_end — nothing to prorate. */
      kind: "NO_REMAINING_TIME";
    }
  | {
      /** Stacked early renewals: remaining prepaid time > one stored cycle; exact proration needs the period ledger. */
      kind: "REQUIRES_PERIOD_LEDGER";
      reason: "MULTI_CYCLE_PREPAID";
      remainingMs: number;
      nominalCycleMs: number;
    }
  | {
      /** A period's cycle differs from the target cycle — cross-cycle upgrade is out of V1 scope. */
      kind: "NOT_SAME_CYCLE";
    };

/** BigInt floor-division for non-negative numerator/denominator (denominator > 0). */
function floorDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator; // both non-negative → truncation == floor
}

/** Floor a non-negative minor-unit amount DOWN to a whole EGP (multiple of 100), customer's favour. */
export function floorToWholeEgpMinor(minor: bigint): bigint {
  return (minor / 100n) * 100n;
}

/**
 * One EFFECTIVE (top-seq) subscription_period slice with remaining time. The
 * repository resolves the effective timeline from the ledger and passes the
 * slices whose period_end > now. `cyclePriceMinor` is THIS period's locked
 * per-cycle rate; `nominalCycle*` is the full cycle the (possibly partial) span
 * belongs to (the valuation denominator).
 */
export interface ProrationPeriodSlice {
  billingCycle: BillingCycle;
  cyclePriceMinor: number;
  periodStartMs: number;
  periodEndMs: number;
  nominalCycleStartMs: number;
  nominalCycleEndMs: number;
}

export interface UpgradeProrationOverPeriodsInput {
  targetPlan: StandardPlanCode;
  /** The upgrade cycle (V1: same as the subscription's current cycle). */
  billingCycle: BillingCycle;
  /** Target plan's CURRENT official catalog price for `billingCycle`. */
  targetCatalogPriceMinor: number;
  nowMs: number;
  /** Effective remaining period slices (period_end > now), from the ledger. */
  periods: ProrationPeriodSlice[];
}

/**
 * EXACT upgrade proration over the period ledger (spec §8). For each effective
 * period overlapping [now, its end], integrate the price DIFFERENCE
 *   (targetRate − period.rate) × overlap / nominalCycle
 * with BigInt integer arithmetic, floored per period in the customer's favour,
 * summed, then floored to whole EGP. Handles stacked early renewals and periods
 * locked at DIFFERENT historical prices exactly (each period carries its own
 * rate). Same-cycle only: a period whose cycle differs from the target cycle →
 * NOT_SAME_CYCLE (cross-cycle is out of V1 scope).
 */
export function computeUpgradeProrationOverPeriods(input: UpgradeProrationOverPeriodsInput): UpgradeProrationResult {
  const now = input.nowMs;
  const target = BigInt(input.targetCatalogPriceMinor);

  let totalDue = 0n;
  let totalCredit = 0n;
  let totalTargetCost = 0n;
  let anyRemaining = false;

  for (const p of input.periods) {
    const overlapStart = Math.max(now, p.periodStartMs);
    const overlapEnd = p.periodEndMs;
    const d = overlapEnd - overlapStart;
    if (d <= 0) continue; // no remaining time in this period
    if (p.billingCycle !== input.billingCycle) return { kind: "NOT_SAME_CYCLE" };
    const L = p.nominalCycleEndMs - p.nominalCycleStartMs;
    if (L <= 0) continue; // corrupt slice — skip defensively
    anyRemaining = true;

    const remaining = BigInt(d);
    const cycle = BigInt(L);
    const rate = BigInt(p.cyclePriceMinor);

    // Per-period floor of the difference (customer favour) — signed sum tolerates
    // a period locked ABOVE the target (rare) as a credit.
    const diff = target - rate;
    const duePeriod = diff >= 0n ? floorDiv(diff * remaining, cycle) : -floorDiv(-diff * remaining, cycle);
    totalDue += duePeriod;
    totalCredit += floorDiv(rate * remaining, cycle);
    totalTargetCost += floorDiv(target * remaining, cycle);
  }

  if (!anyRemaining) return { kind: "NO_REMAINING_TIME" };
  if (totalDue <= 0n) return { kind: "NON_POSITIVE", rawDueMinor: Number(totalDue) };

  const amountDueMinor = floorToWholeEgpMinor(totalDue);
  if (amountDueMinor <= 0n) return { kind: "NON_POSITIVE", rawDueMinor: Number(totalDue) };

  return {
    kind: "DUE",
    amountDueMinor: Number(amountDueMinor),
    creditRemainingMinor: Number(totalCredit),
    targetRemainingCostMinor: Number(totalTargetCost),
    normalTargetPriceMinor: input.targetCatalogPriceMinor,
    remainingMs: input.periods.reduce((acc, p) => acc + Math.max(0, p.periodEndMs - Math.max(now, p.periodStartMs)), 0),
    nominalCycleMs: 0,
  };
}

/**
 * Convenience for the degenerate "single stored current cycle" case: delegates
 * to `computeUpgradeProrationOverPeriods` with one full-cycle slice. Valid ONLY
 * when `now` is inside the stored cycle; if stacked early renewals have pushed
 * period_start into the future (now < period_start), the caller MUST supply the
 * full ledger to `computeUpgradeProrationOverPeriods` instead → REQUIRES_PERIOD_LEDGER.
 */
export function computeUpgradeProration(input: UpgradeProrationInput): UpgradeProrationResult {
  const remainingMs = input.periodEndMs - input.nowMs;
  const nominalCycleMs = input.periodEndMs - input.periodStartMs;
  if (nominalCycleMs <= 0 || remainingMs <= 0) return { kind: "NO_REMAINING_TIME" };
  if (input.nowMs < input.periodStartMs) {
    return { kind: "REQUIRES_PERIOD_LEDGER", reason: "MULTI_CYCLE_PREPAID", remainingMs, nominalCycleMs };
  }
  const result = computeUpgradeProrationOverPeriods({
    targetPlan: input.targetPlan,
    billingCycle: input.billingCycle,
    targetCatalogPriceMinor: input.targetCatalogPriceMinor,
    nowMs: input.nowMs,
    periods: [
      {
        billingCycle: input.billingCycle,
        cyclePriceMinor: input.currentPriceMinorSnapshot,
        periodStartMs: input.periodStartMs,
        periodEndMs: input.periodEndMs,
        nominalCycleStartMs: input.periodStartMs,
        nominalCycleEndMs: input.periodEndMs,
      },
    ],
  });
  if (result.kind === "DUE") return { ...result, remainingMs, nominalCycleMs };
  return result;
}

/**
 * Downgrade usage validation (spec §16) — PURE decision. The caller supplies the
 * workspace's real current usage (distinct active students in the current month;
 * active non-owner team members) and the TARGET plan; this only decides ALLOW /
 * BLOCKED_BY_USAGE and echoes the numbers for a safe, explanatory message.
 */
export interface DowngradeUsageInput {
  targetPlan: StandardPlanCode;
  currentActiveStudents: number;
  currentActiveTeamMembers: number;
}

export interface DowngradeUsageDecision {
  decision: "ALLOW" | "BLOCKED_BY_USAGE";
  currentStudents: number;
  targetStudentLimit: number;
  currentTeamMembers: number;
  targetTeamLimit: number;
  studentsOverBy: number; // 0 when within limit
  teamOverBy: number; // 0 when within limit
}

export function evaluateDowngradeUsage(input: DowngradeUsageInput): DowngradeUsageDecision {
  const plan = STANDARD_PLANS[input.targetPlan];
  const studentsOverBy = Math.max(0, input.currentActiveStudents - plan.maxActiveStudents);
  const teamOverBy = Math.max(0, input.currentActiveTeamMembers - plan.maxTeamMembers);
  return {
    decision: studentsOverBy > 0 || teamOverBy > 0 ? "BLOCKED_BY_USAGE" : "ALLOW",
    currentStudents: input.currentActiveStudents,
    targetStudentLimit: plan.maxActiveStudents,
    currentTeamMembers: input.currentActiveTeamMembers,
    targetTeamLimit: plan.maxTeamMembers,
    studentsOverBy,
    teamOverBy,
  };
}
