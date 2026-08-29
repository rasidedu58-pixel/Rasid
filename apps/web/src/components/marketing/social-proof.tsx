"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Star } from "lucide-react";
import { Counter } from "./anim";

/*
 * Social-proof SHELLS. These components are complete but deliberately hold NO
 * data yet — the arrays below are empty, so each section renders `null` and the
 * public page shows nothing fabricated. When you provide REAL testimonials,
 * partner logos, or metrics, fill the arrays and the sections appear
 * automatically. Do not populate with invented names/logos/numbers.
 */

export interface Testimonial {
  quote: string;
  name: string;
  role: string;
  rating?: number; // 1–5
}
export interface PartnerLogo {
  name: string;
  /** Optional inline SVG/URL. When absent, the name renders as a wordmark. */
  src?: string;
}
export interface Stat {
  value: number;
  suffix?: string;
  label: string;
}

// ─── Fill these with REAL content when available ───
const TESTIMONIALS: Testimonial[] = [];
const LOGOS: PartnerLogo[] = [];
const STATS: Stat[] = [];
// ───────────────────────────────────────────────────

/** Auto-rotating testimonials. Renders nothing until real testimonials exist. */
export function TestimonialsSection() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const n = TESTIMONIALS.length;

  useEffect(() => {
    if (n <= 1 || reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 6000);
    return () => clearInterval(t);
  }, [n, reduce]);

  if (n === 0) return null;
  const t = TESTIMONIALS[i]!;

  return (
    <section className="border-t border-border bg-surface-sunken py-20">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <p className="text-sm font-semibold tracking-wide text-brand">آراء المعلمين</p>
        <h2 className="mt-3 text-h2 text-text-primary">ماذا يقول مستخدمو راصد</h2>
        <div className="relative mt-10 min-h-[12rem]">
          <AnimatePresence mode="wait">
            <motion.blockquote
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl border border-border bg-surface p-8 shadow-sm"
            >
              {t.rating ? (
                <div className="mb-4 flex justify-center gap-1">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} className={`h-4 w-4 ${s < t.rating! ? "fill-accent text-accent" : "text-border-strong"}`} aria-hidden />
                  ))}
                </div>
              ) : null}
              <p className="text-lg leading-relaxed text-text-primary">“{t.quote}”</p>
              <footer className="mt-5">
                <p className="font-semibold text-text-primary">{t.name}</p>
                <p className="text-sm text-text-secondary">{t.role}</p>
              </footer>
            </motion.blockquote>
          </AnimatePresence>
        </div>
        {n > 1 ? (
          <div className="mt-6 flex justify-center gap-2">
            {TESTIMONIALS.map((_, d) => (
              <button
                key={d}
                type="button"
                onClick={() => setI(d)}
                aria-label={`الرأي ${d + 1}`}
                className={`h-2 rounded-full transition-all ${d === i ? "w-6 bg-brand" : "w-2 bg-border-strong hover:bg-text-tertiary"}`}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Auto-scrolling partner-logo marquee. Renders nothing until real logos exist. */
export function LogosSection() {
  if (LOGOS.length === 0) return null;
  const row = [...LOGOS, ...LOGOS];
  return (
    <section className="border-t border-border py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-center text-sm text-text-tertiary">يستخدمه المعلمون والمراكز في</p>
        <div className="marquee mt-6">
          <div className="marquee-track">
            {row.map((logo, idx) => (
              <span key={idx} className="mx-8 whitespace-nowrap text-lg font-semibold text-text-tertiary">
                {logo.name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Data-driven stat band with count-up. Renders nothing until real stats exist. */
export function StatsSection() {
  if (STATS.length === 0) return null;
  return (
    <section className="border-t border-border py-16">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-4 sm:px-6 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-surface p-6 text-center">
            <p className="text-4xl font-bold tracking-tight text-text-primary">
              <span className="text-gradient">
                <Counter to={s.value} />
                {s.suffix ?? ""}
              </span>
            </p>
            <p className="mt-2 text-sm text-text-secondary">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
