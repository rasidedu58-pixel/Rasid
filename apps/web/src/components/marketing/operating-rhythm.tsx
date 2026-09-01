"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

const STEPS = ["سجّل", "افهم", "تصرّف", "تابع"];

/**
 * The سجّل → افهم → تصرّف → تابع rhythm with a focus that TRAVELS through the
 * four beats once the flow enters view — detection→focus→action→resolution in
 * miniature, then it settles. No loop. Under reduced motion (or no JS) every
 * beat is simply shown in its resting emphasis. RTL-native (flows right→left).
 */
export function OperatingRhythm() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") return;

    let started = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || started) continue;
          started = true;
          io.unobserve(el);
          STEPS.forEach((_, i) => timers.push(setTimeout(() => setActive(i), 250 + i * 620)));
          // Resolution: let the last beat rest, then release the focus.
          timers.push(setTimeout(() => setActive(null), 250 + STEPS.length * 620 + 900));
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div ref={ref} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base font-semibold">
      {STEPS.map((step, i) => (
        <span key={step} className="flex items-center gap-2.5">
          <span
            className="relative transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ color: active === i ? "hsl(var(--brand))" : "hsl(var(--text-secondary))", transform: active === i ? "translateY(-1px) scale(1.04)" : "none" }}
          >
            {step}
            <span
              aria-hidden
              className="absolute -bottom-1.5 start-0 h-0.5 rounded-full bg-brand transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ inlineSize: active === i ? "100%" : "0%", opacity: active === i ? 1 : 0 }}
            />
          </span>
          {i < STEPS.length - 1 ? (
            <ArrowLeft className="h-4 w-4 transition-colors duration-500" style={{ color: active !== null && active > i ? "hsl(var(--brand) / 0.7)" : "hsl(var(--text-tertiary))" }} aria-hidden />
          ) : null}
        </span>
      ))}
    </div>
  );
}
