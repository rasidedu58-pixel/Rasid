"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { PRODUCT_SHOWCASE_SLIDES, pickShowcaseSrc, type ProductShowcaseSlide } from "../../lib/marketing/product-showcase-slides";
import { useTheme } from "../../lib/theme-provider";

/**
 * Product Showcase (§H) — the landing page's real-product proof, right
 * after the Hero's CTA/trust line (§Q) and before the next section. Below
 * `sm` this is a swipeable, snap-to-card horizontal rail (one slide focal +
 * a peek of its neighbours, §I) — reusing the exact `.pricing-rail`
 * convention already shipped for mobile pricing, under a new
 * `.showcase-rail` class since slide sizing/peek differ. At `sm` and up it
 * becomes small tabs above one large, centred visual that crossfades on tab
 * change (§J). No autoplay, ever (§Y) — the viewer is the only thing that
 * ever advances a slide.
 */
export function ProductShowcase() {
  const { theme } = useTheme();
  const reduce = useReducedMotion();

  // ---- Mobile rail: active-slide tracking (same IntersectionObserver
  // pattern as the pricing carousel — RTL-safe, no scrollLeft assumptions). ----
  const railRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [mobileActive, setMobileActive] = useState(0);

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
        if (bestRatio > 0) setMobileActive(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] },
    );
    for (const el of cardRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  // ---- Desktop: small tabs control ONE large, crossfading visual. ----
  const [desktopActive, setDesktopActive] = useState(0);
  const activeSlide = PRODUCT_SHOWCASE_SLIDES[desktopActive]!;

  // ---- Scroll-driven entrance (§R) — same technique as the Hero's own
  // product visual: framer-motion (already a dependency), disabled under
  // reduced motion. ----
  const frameRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: frameRef, offset: ["start 92%", "start 55%"] });
  // Under reduced motion the output range collapses to a constant (1, 1) —
  // NOT just omitting the `style` prop — because framer-motion's
  // MotionValues can keep writing to the DOM imperatively across renders
  // regardless of whether a later render still passes them into `style`.
  // Collapsing the transform's own output range is what actually guarantees
  // zero scroll-linked motion for a reduced-motion viewer.
  const scale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [0.96, 1]);
  const opacity = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [0.85, 1]);

  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20" aria-label="جولة سريعة داخل راصد">
      {/* Desktop tabs — small, above the visual (§J/§O). */}
      <div className="mb-6 hidden justify-center sm:flex">
        <div role="tablist" aria-label="اختر شاشة لعرضها" className="inline-flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-sm">
          {PRODUCT_SHOWCASE_SLIDES.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              role="tab"
              aria-selected={i === desktopActive}
              onClick={() => setDesktopActive(i)}
              className={`focus-ring rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                i === desktopActive ? "bg-gradient-cta text-brand-foreground shadow-sm" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {slide.label}
            </button>
          ))}
        </div>
      </div>

      <motion.div
        ref={frameRef}
        style={{ scale, opacity }}
        className="showcase-frame relative mx-auto max-w-3xl overflow-hidden rounded-[28px] border border-border/80 bg-surface shadow-floating sm:rounded-[32px]"
      >
        <div aria-hidden className="pointer-events-none absolute -inset-8 -z-10 bg-[radial-gradient(60%_60%_at_50%_20%,hsl(var(--brand)/0.14),transparent_70%)]" />

        {/* Desktop: single crossfading visual. Aspect ratio 1800/875 =
            the natural shape of every real captured screenshot (see
            product-showcase-slides.ts) — showing them at 4:3 would either
            crop off the sidebar or leave letterbox bars, both of which
            waste the actual content of the shot. */}
        <div className="relative hidden aspect-[1800/875] w-full sm:block">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeSlide.id}
              initial={reduce ? undefined : { opacity: 0.4, x: 14, scale: 0.985 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduce ? undefined : { opacity: 0.4, x: -14, scale: 0.985 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0"
            >
              <SlideImage slide={activeSlide} theme={theme} priority={desktopActive === 0} />
            </motion.div>
          </AnimatePresence>
        </div>
        <SlideCaption slide={activeSlide} className="hidden sm:block" />

        {/* Mobile: swipeable snap rail. */}
        <div ref={railRef} className="showcase-rail sm:hidden" role="list">
          {PRODUCT_SHOWCASE_SLIDES.map((slide, i) => (
            <div
              key={slide.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              role="listitem"
              className="showcase-card"
              data-active={i === mobileActive || undefined}
            >
              {/* Mobile card: same 1800/875 aspect as the desktop frame,
                  so a horizontal screenshot stays legible on a phone. */}
              <div className="relative aspect-[1800/875] w-full overflow-hidden rounded-2xl border border-border/80 bg-surface">
                <SlideImage slide={slide} theme={theme} priority={i === 0} />
              </div>
              <SlideCaption slide={slide} className="mt-3" />
            </div>
          ))}
        </div>
      </motion.div>

      {/* Mobile dot indicator (§O — dots, not 5 crowded tabs). */}
      <div className="mt-5 flex items-center justify-center gap-1.5 sm:hidden" role="tablist" aria-label="اختيار الشاشة">
        {PRODUCT_SHOWCASE_SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={i === mobileActive}
            aria-label={slide.label}
            onClick={() => cardRefs.current[i]?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" })}
            className={`focus-ring h-2 rounded-full transition-all duration-200 ${i === mobileActive ? "w-5 bg-brand" : "w-2 bg-border-strong"}`}
          />
        ))}
      </div>
    </section>
  );
}

function SlideImage({ slide, theme, priority }: { slide: ProductShowcaseSlide; theme: "light" | "dark"; priority: boolean }) {
  const src = pickShowcaseSrc(theme, slide);
  return (
    <Image
      src={src}
      alt={slide.alt}
      fill
      sizes="(max-width: 640px) 88vw, (max-width: 1024px) 80vw, 768px"
      quality={80}
      priority={priority}
      className="object-cover"
    />
  );
}

function SlideCaption({ slide, className }: { slide: ProductShowcaseSlide; className?: string }) {
  return (
    <div className={`px-5 pb-5 text-center sm:px-8 sm:pb-8 sm:pt-5 ${className ?? ""}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.05em] text-brand">{slide.label}</p>
      <h3 className="mt-1.5 text-lg font-semibold text-text-primary sm:text-xl">{slide.title}</h3>
      <p className="mt-1 text-sm text-text-secondary">{slide.description}</p>
    </div>
  );
}
