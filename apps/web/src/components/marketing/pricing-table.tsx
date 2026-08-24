import Link from "next/link";
import { Badge, Card, CardContent } from "@academic-precision/ui";
import { Check } from "lucide-react";
import { PRICING_PLANS, TRIAL_DAYS } from "../../lib/marketing/pricing-config";

/**
 * Shared pricing grid — used on both the landing page (teaser) and the
 * full `/pricing` page, driven entirely by `pricing-config.ts`. Every
 * button starts the SAME real trial signup (see that file's own comment
 * for why — no multi-tier Paddle billing exists yet); only the custom
 * ("أكثر من 1000 طالب") tier routes to Support instead.
 */
export function PricingTable() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {PRICING_PLANS.map((plan) => (
        <Card
          key={plan.id}
          className={`flex flex-col gap-5 p-6 ${plan.highlighted ? "border-brand shadow-md ring-1 ring-brand" : ""}`}
        >
          <CardContent className="flex flex-1 flex-col gap-5 p-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-secondary">{plan.tagline}</span>
              {plan.highlighted ? <Badge tone="brand">الأكثر اختيارًا</Badge> : null}
            </div>

            <div>
              <p className="text-lg font-semibold text-text-primary">{plan.studentCapacityLabel}</p>
              {plan.monthlyPriceEGP !== null ? (
                <p className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-bold tabular-nums text-text-primary">{plan.monthlyPriceEGP}</span>
                  <span className="text-sm text-text-secondary">جنيه / شهريًا</span>
                </p>
              ) : (
                <p className="mt-1 text-2xl font-bold text-text-primary">تسعير خاص</p>
              )}
            </div>

            <ul className="flex flex-1 flex-col gap-2 text-sm text-text-secondary">
              <PlanFeature label="كل مزايا راصد الأساسية بلا استثناء" />
              <PlanFeature label="مجموعات وأشهر تشغيلية غير محدودة" />
              <PlanFeature label="تقارير ومتابعة مالية كاملة" />
              <PlanFeature label={`تجربة مجانية ${TRIAL_DAYS} يومًا بدون بطاقة`} />
            </ul>

            <Link
              href={plan.isCustom ? "/support" : "/signup"}
              className={`flex h-10 items-center justify-center rounded-md text-sm font-medium transition-colors ${
                plan.highlighted ? "bg-brand text-brand-foreground hover:bg-brand/90" : "border border-border-strong text-text-primary hover:bg-surface-sunken"
              }`}
            >
              {plan.isCustom ? "تواصل معنا" : "ابدأ تجربتك المجانية"}
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PlanFeature({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
      <span>{label}</span>
    </li>
  );
}
