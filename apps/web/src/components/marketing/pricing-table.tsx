"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@academic-precision/ui";
import { Users } from "lucide-react";
import {
  PRICING_PLANS,
  SHARED_CAPABILITIES,
  SHARED_CAPABILITIES_NOTE,
  type PricingPlan,
} from "../../lib/marketing/pricing-config";

/**
 * Shared pricing grid — used on both the landing page (teaser) and the full
 * `/pricing` page, driven entirely by `pricing-config.ts`.
 *
 * PRESENTATION POLICY (owner review):
 *  • A single "كل الخطط تشمل" block sits ABOVE the grid, listing the real
 *    shared product surface once — so no card falsely implies a capability
 *    is plan-locked.
 *  • Each card shows ONLY genuine per-plan differences: name, positioning,
 *    optional badge, capacity, price, team-seat count, CTA.
 *
 * Layout: on `sm:` and up this is the original comparison grid. Below `sm`
 * it becomes a swipeable snap-to-card horizontal rail (one card focal + a
 * peek of neighbours). JS enhancements: center on Professional on mount,
 * track the centred card for the dot indicator, jump on dot tap.
 */
export function PricingTable() {
  const railRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [active, setActive] = useState(() => Math.max(0, PRICING_PLANS.findIndex((p) => p.highlighted)));

  useEffect(() => {
    const isMobile = typeof matchMedia !== "undefined" && matchMedia("(max-width: 639px)").matches;
    if (!isMobile) return;
    const initial = cardRefs.current[active];
    initial?.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
  }, []);

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
      {/* Shared "كل الخطط تشمل" block — real product surface, listed once.
          Compact chip grid on all sizes; two rows on mobile (3×2), one row
          on ≥sm (6×1) so it never inflates landing height. */}
      <div className="mb-6 rounded-2xl border border-border bg-surface-sunken px-4 py-4 sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-center text-sm font-semibold text-text-primary">كل الخطط تشمل</p>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {SHARED_CAPABILITIES.map((cap) => (
            <li
              key={cap.id}
              className="flex items-center justify-center rounded-full border border-border bg-surface px-3 py-1.5 text-center text-xs font-medium text-text-primary sm:text-sm"
            >
              {cap.label}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-center text-xs leading-relaxed text-text-secondary sm:text-sm">
          {SHARED_CAPABILITIES_NOTE}
        </p>
      </div>

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
      {plan.badge ? (
        <div className="mb-3 flex">
          <Badge tone="brand" className="border border-brand/20 shadow-sm">{plan.badge}</Badge>
        </div>
      ) : null}

      <span className="text-sm font-medium text-text-secondary">{plan.tagline}</span>
      <p className="mt-1 text-sm leading-relaxed text-text-secondary">{plan.positioning}</p>

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

      {/* Only the real per-plan lever: team-seat count. Product surface is
          listed once in the shared block above the grid — never repeated
          per card. */}
      {plan.teamSeatsLabel ? (
        <div className="mt-5 flex flex-1 items-start gap-2 text-sm text-text-primary">
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>{plan.teamSeatsLabel}</span>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      <Link
        href={plan.isCustom ? "/support" : "/signup"}
        className={`focus-ring mt-6 flex h-11 items-center justify-center rounded-md text-sm font-medium transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] ${
          highlighted
            ? "bg-gradient-cta text-brand-foreground shadow-sm hover:shadow-glow hover:brightness-[1.08]"
            : "border border-border-strong bg-surface text-text-primary hover:bg-surface-sunken"
        }`}
      >
        {plan.isCustom ? "اطلب عرضًا مخصصًا" : "ابدأ تجربتك المجانية"}
      </Link>
    </div>
  );
}
