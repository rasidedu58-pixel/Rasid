"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@academic-precision/ui";
import { Check } from "lucide-react";
import { PRICING_PLANS, type PricingPlan } from "../../lib/marketing/pricing-config";

/**
 * Shared pricing grid — used on both the landing page (teaser) and the full
 * `/pricing` page, driven entirely by `pricing-config.ts` (which derives from
 * the billing catalog — MONTHLY-only, single source of truth). Every button
 * starts the SAME real trial signup; only the custom ("أكثر من 3000 طالب") tier
 * routes to Support.
 *
 * Layout (§5): on `sm:` and up this is the original comparison grid (two rows
 * of three on `lg`, unchanged). Below `sm` it becomes a swipeable, snap-to-card
 * horizontal rail — ONE card focal at a time with a peek of its neighbours —
 * so a 7-plan comparison no longer means scrolling a very long vertical list.
 * The rail/grid switch is pure CSS (`.pricing-rail`, see globals.css): the DOM
 * never changes shape, so it degrades to a perfectly usable native horizontal
 * scroller with zero JS. JS only adds three enhancements: centering on the
 * Professional plan on mobile mount, tracking which card is centred (for the
 * active-card emphasis + dot indicator), and letting a dot jump to its card.
 */
export function PricingTable() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [active, setActive] = useState(() => Math.max(0, PRICING_PLANS.findIndex((p) => p.highlighted)));

  // Land on the focal (Professional) plan on mobile, instantly (no motion —
  // this corrects initial scroll position, it isn't a decorative animation).
  // Deliberately reads `active`'s initial value only, once, on mount — it is
  // never meant to re-run when the user later scrolls to a different card.
  useEffect(() => {
    const isMobile = typeof matchMedia !== "undefined" && matchMedia("(max-width: 639px)").matches;
    if (!isMobile) return;
    const initial = cardRefs.current[active];
    initial?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
  }, []);

  // Track the centred card via IntersectionObserver against the rail itself
  // (RTL-safe: unlike reading `scrollLeft`, intersection ratios don't depend
  // on a browser's RTL scroll-origin convention).
  useEffect(() => {
    const root = railRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = cardRefs.current.indexOf(entry.target as HTMLDivElement);
          if (idx !== -1) ratios.set(idx, entry.intersectionRatio);
        }
        let best = 0;
        let bestRatio = 0;
        for (const [idx, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = idx;
          }
        }
        if (bestRatio > 0) setActive(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] },
    );
    for (const el of cardRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  function goTo(index: number) {
    cardRefs.current[index]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  return (
    <div>
      <p className="mb-4 hidden text-center text-sm text-text-secondary sm:block">
        كل الباقات تشمل مزايا راصد كاملة — بدون استثناء.
      </p>

      <div ref={railRef} className="pricing-rail" role="list">
        {PRICING_PLANS.map((plan, i) => (
          <div
            key={plan.id}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            role="listitem"
            className="pricing-card"
            data-active={i === active || undefined}
          >
            <PlanCard plan={plan} />
          </div>
        ))}
      </div>

      {/* Mobile-only indicator — dots double as jump targets. */}
      <div className="mt-5 flex items-center justify-center gap-1.5 sm:hidden" role="tablist" aria-label="اختيار الباقة">
        {PRICING_PLANS.map((plan, i) => (
          <button
            key={plan.id}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={plan.tagline}
            onClick={() => goTo(i)}
            className={`focus-ring h-2 rounded-full transition-all duration-200 ${
              i === active ? "w-5 bg-brand" : "w-2 bg-border-strong"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan }: { plan: PricingPlan }) {
  const highlighted = !!plan.highlighted;
  return (
    <div
      className={`relative flex h-full flex-col rounded-2xl border p-6 transition-all duration-200 ${
        plan.isCustom ? "border-dashed" : ""
      } ${
        highlighted
          ? "price-sheen border-brand bg-brand-subtle/40 shadow-floating ring-1 ring-brand/30 lg:-translate-y-2"
          : "border-border bg-surface shadow-sm hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
      }`}
    >
      {/* Recommended badge — in the card's normal flow (never clipped by the
          card's own `overflow:hidden` sheen, never overlapping the border). */}
      {plan.badge ? (
        <div className="mb-3 flex">
          <Badge tone="brand" className="border border-brand/20 shadow-sm">{plan.badge}</Badge>
        </div>
      ) : null}

      <span className="text-sm font-medium text-text-secondary">{plan.tagline}</span>

      <p className="mt-4 text-lg font-semibold text-text-primary">{plan.studentCapacityLabel}</p>

      <div className="mt-1 min-h-[3rem]">
        {plan.monthlyPriceEGP !== null ? (
          <p className="flex items-baseline gap-1.5">
            <span className="font-english text-4xl font-bold tabular-nums tracking-tight text-text-primary">{plan.monthlyPriceEGP}</span>
            <span className="text-sm text-text-secondary">جنيه / شهريًا</span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <span>تسعير خاص</span>
            <span className="text-xs font-medium text-text-tertiary">(طلب عرض)</span>
          </p>
        )}
      </div>

      {/* Every plan includes all features — stated once above the section, not
          repeated in every one of the 7 cards. */}
      <div className="mt-4 flex flex-1 flex-col justify-end gap-2">
        {!plan.isCustom ? (
          <p className="flex items-start gap-2 text-sm text-text-secondary sm:hidden">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <span>كل مزايا راصد متاحة</span>
          </p>
        ) : null}
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
}
