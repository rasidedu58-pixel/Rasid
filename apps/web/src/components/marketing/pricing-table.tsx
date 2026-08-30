import Link from "next/link";
import { Badge } from "@academic-precision/ui";
import { Check } from "lucide-react";
import { PRICING_PLANS, TRIAL_DAYS } from "../../lib/marketing/pricing-config";

/**
 * Shared pricing grid — used on both the landing page (teaser) and the full
 * `/pricing` page, driven entirely by `pricing-config.ts`. Every button starts
 * the SAME real trial signup (see that file's own comment — no multi-tier
 * Paddle billing exists yet); only the custom ("أكثر من 1000 طالب") tier routes
 * to Support instead. On lg the six plans lay out as two rows of three, with
 * the highlighted "الأكثر اختيارًا" plan sitting in the first row.
 */
export function PricingTable() {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {PRICING_PLANS.map((plan) => {
        const highlighted = !!plan.highlighted;
        return (
          <div
            key={plan.id}
            className={`relative flex flex-col rounded-2xl border p-6 transition-all duration-200 ${
              highlighted
                ? "border-brand bg-brand-subtle/40 shadow-floating ring-1 ring-brand/30 lg:-translate-y-2"
                : "border-border bg-surface shadow-sm hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
            }`}
          >
            {highlighted ? (
              <span className="absolute -top-3 start-6">
                <Badge tone="brand" className="border border-brand/20 shadow-sm">الأكثر اختيارًا</Badge>
              </span>
            ) : null}

            <span className="text-sm font-medium text-text-secondary">{plan.tagline}</span>

            <p className="mt-4 text-lg font-semibold text-text-primary">{plan.studentCapacityLabel}</p>

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

            {/* Every plan includes all features (stated once above the grid);
                the only differentiator is capacity — so no repeated list here. */}
            <div className="mt-4 flex flex-1 flex-col gap-2">
              <p className="flex items-start gap-2 text-sm text-text-secondary">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span>كل مزايا راصد • تجربة {TRIAL_DAYS} يومًا مجانًا</span>
              </p>
              {highlighted ? <p className="text-xs font-medium text-brand">الأنسب لأغلب المدرّسين</p> : null}
            </div>

            <Link
              href={plan.isCustom ? "/support" : "/signup"}
              className={`focus-ring mt-6 flex h-11 items-center justify-center rounded-md text-sm font-medium transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] ${
                highlighted
                  ? "bg-gradient-cta text-brand-foreground shadow-sm hover:shadow-glow hover:brightness-[1.08]"
                  : "border border-border-strong bg-surface text-text-primary hover:bg-surface-sunken"
              }`}
            >
              {plan.isCustom ? "تواصل معنا" : "ابدأ تجربتك المجانية"}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
