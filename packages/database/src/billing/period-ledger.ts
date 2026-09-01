/**
 * Period-ledger resolution — Billing Engine, Phase 4. PURE (no DB), so it is
 * unit-testable without a database. The repository fetches raw
 * `subscription_periods` rows and calls these; nothing here reads I/O.
 *
 * The ledger is append-only and rows may OVERLAP (an UPGRADE row covers
 * [now, period_end] of a period it supersedes). The EFFECTIVE plan at an instant
 * `t` is the plan of the HIGHEST-`seq` row whose [period_start, period_end)
 * contains `t`. `resolveEffectiveSegments` sweeps the boundaries and returns the
 * gapless, non-overlapping effective timeline clipped to [now, ∞) — exactly the
 * slices upgrade proration integrates over.
 */
import type { BillingCycle, ProrationPeriodSlice } from "@academic-precision/contracts";

export interface LedgerPeriodRow {
  id: string;
  seq: number;
  planCode: string;
  billingCycle: string;
  cyclePriceMinor: number;
  planPriceVersion: number | null;
  periodStartMs: number;
  periodEndMs: number;
  nominalCycleStartMs: number;
  nominalCycleEndMs: number;
}

/** The effective row covering instant `t` (highest seq among rows whose span contains t), or null. */
export function effectiveRowAt(rows: LedgerPeriodRow[], t: number): LedgerPeriodRow | null {
  let best: LedgerPeriodRow | null = null;
  for (const r of rows) {
    if (r.periodStartMs <= t && t < r.periodEndMs) {
      if (best === null || r.seq > best.seq) best = r;
    }
  }
  return best;
}

/** The effective plan code at instant `t`, or null when no period covers `t`. */
export function effectivePlanAt(rows: LedgerPeriodRow[], t: number): string | null {
  return effectiveRowAt(rows, t)?.planCode ?? null;
}

export interface EffectiveSegment {
  planCode: string;
  billingCycle: string;
  cyclePriceMinor: number;
  startMs: number;
  endMs: number;
  nominalCycleStartMs: number;
  nominalCycleEndMs: number;
  sourceRowId: string;
}

/**
 * The gapless, non-overlapping EFFECTIVE timeline from `nowMs` onward. Each
 * segment is a maximal interval over which a single ledger row is effective
 * (top-seq). Segments before `nowMs` are clipped away.
 */
export function resolveEffectiveSegments(rows: LedgerPeriodRow[], nowMs: number): EffectiveSegment[] {
  if (rows.length === 0) return [];
  const bounds = new Set<number>([nowMs]);
  for (const r of rows) {
    if (r.periodStartMs >= nowMs) bounds.add(r.periodStartMs);
    if (r.periodEndMs >= nowMs) bounds.add(r.periodEndMs);
  }
  const points = [...bounds].filter((p) => p >= nowMs).sort((a, b) => a - b);

  const segments: EffectiveSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (b <= a) continue;
    const mid = a + (b - a) / 2;
    const eff = effectiveRowAt(rows, mid);
    if (!eff) continue; // a genuine gap in coverage
    const last = segments[segments.length - 1];
    // Merge adjacent segments that resolve to the SAME effective row.
    if (last && last.sourceRowId === eff.id && last.endMs === a) {
      last.endMs = b;
      continue;
    }
    segments.push({
      planCode: eff.planCode,
      billingCycle: eff.billingCycle,
      cyclePriceMinor: eff.cyclePriceMinor,
      startMs: a,
      endMs: b,
      nominalCycleStartMs: eff.nominalCycleStartMs,
      nominalCycleEndMs: eff.nominalCycleEndMs,
      sourceRowId: eff.id,
    });
  }
  return segments;
}

/** Convert effective remaining segments into proration slices for `computeUpgradeProrationOverPeriods`. */
export function toProrationSlices(segments: EffectiveSegment[]): ProrationPeriodSlice[] {
  return segments.map((s) => ({
    billingCycle: s.billingCycle as BillingCycle,
    cyclePriceMinor: s.cyclePriceMinor,
    periodStartMs: s.startMs,
    periodEndMs: s.endMs,
    nominalCycleStartMs: s.nominalCycleStartMs,
    nominalCycleEndMs: s.nominalCycleEndMs,
  }));
}

/** The latest paid-through instant across all rows (the aggregate period_end), or null. */
export function paidThroughMs(rows: LedgerPeriodRow[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((max, r) => (r.periodEndMs > max ? r.periodEndMs : max), rows[0]!.periodEndMs);
}

/**
 * True when a FUTURE paid period (effective after `now`) has a DIFFERENT plan
 * than the current effective plan — i.e. a committed future plan change already
 * exists in the ledger (e.g. a scheduled downgrade that was paid via an early
 * renewal). Same-plan stacked future periods return false. Phase-4 V1 blocks a
 * new upgrade in this state rather than silently superseding the future period.
 */
export function hasFutureDifferentPlanPeriod(rows: LedgerPeriodRow[], nowMs: number): boolean {
  const segments = resolveEffectiveSegments(rows, nowMs);
  if (segments.length === 0) return false;
  const currentPlan = segments[0]!.planCode; // the segment covering `now`
  return segments.some((s) => s.planCode !== currentPlan);
}
