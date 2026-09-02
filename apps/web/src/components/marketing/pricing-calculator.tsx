"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Users, ArrowLeft } from "lucide-react";
import { PRICING_PLANS, TRIAL_DAYS, type PricingPlan } from "../../lib/marketing/pricing-config";

/** Numeric capacity ceiling for a plan (from the catalog-sourced config); the custom tier is unbounded. */
function planCap(plan: PricingPlan): number {
  return plan.maxActiveStudents;
}

const SORTED = [...PRICING_PLANS].sort((a, b) => planCap(a) - planCap(b));
const MAX_SLIDER = 3000; // the largest standard plan (BUSINESS_PLUS); above this → custom

/**
 * Interactive pricing calculator — the viewer picks how many students they
 * have and we recommend the matching real plan from `pricing-config.ts` (same
 * source as the pricing grid). No fabricated numbers: prices, capacities and
 * the custom tier all come from the real config; there is no annual/discount
 * pricing because the product has none yet.
 */
export function PricingCalculator() {
  const [count, setCount] = useState(120);

  const plan = useMemo<PricingPlan>(() => {
    const wanted = count > MAX_SLIDER ? Infinity : count;
    return SORTED.find((p) => planCap(p) >= wanted) ?? SORTED[SORTED.length - 1]!;
  }, [count]);

  const atMax = count >= MAX_SLIDER;
  const isCustom = plan.isCustom;

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-center">
        {/* Controls */}
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-text-secondary">
            <Users className="h-4 w-4 text-brand" aria-hidden />
            كم عدد طلابك تقريبًا؟
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-text-primary">
              {atMax ? "+3000" : count}
            </span>
            <span className="text-sm text-text-secondary">طالب</span>
          </div>

          <input
            type="range"
            min={10}
            max={MAX_SLIDER + 50}
            step={10}
            value={Math.min(count, MAX_SLIDER + 50)}
            onChange={(e) => setCount(Number(e.target.value))}
            aria-label="عدد الطلاب"
            className="mt-5 w-full accent-[hsl(var(--brand))]"
          />
          <div className="mt-1 flex justify-between text-xs text-text-tertiary">
            <span>10</span>
            <span>+3000</span>
          </div>
        </div>

        {/* Recommendation */}
        <div className="rounded-xl border border-border bg-surface-sunken p-5">
          <p className="text-xs font-semibold tracking-wide text-brand">الباقة المناسبة لك</p>
          <p className="mt-2 text-lg font-semibold text-text-primary">{plan.studentCapacityLabel}</p>

          <div className="mt-1 min-h-[3rem]">
            {plan.monthlyPriceEGP !== null ? (
              <p className="flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tabular-nums tracking-tight text-text-primary">{plan.monthlyPriceEGP}</span>
                <span className="text-sm text-text-secondary">جنيه / شهريًا</span>
              </p>
            ) : (
              <p className="text-2xl font-bold text-text-primary">تسعير خاص</p>
            )}
          </div>

          <Link
            href={isCustom ? "/support" : "/signup"}
            className="focus-ring mt-4 flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-gradient-cta text-sm font-medium text-brand-foreground shadow-sm transition-[box-shadow,filter] duration-150 hover:shadow-glow hover:brightness-[1.08]"
          >
            {isCustom ? "تواصل معنا" : "ابدأ تجربتك المجانية"}
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <p className="mt-3 text-center text-xs text-text-tertiary">
            تجربة {TRIAL_DAYS} يومًا مجانًا — بدون بطاقة.
          </p>
        </div>
      </div>
    </div>
  );
}
