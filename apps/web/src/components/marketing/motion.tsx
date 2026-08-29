"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * UI-8 marketing motion — CSS-only, progressive enhancement.
 *
 * `MotionRoot` marks the document with `.js-motion` on mount, which is the
 * ONLY thing that activates the reveal "hidden" state (see globals.css). So
 * with no JS — or before hydration — every `Reveal` child renders fully
 * visible, keeping the page crawlable and no-JS friendly. `prefers-reduced-
 * motion` forces the final static state regardless.
 */
export function MotionRoot() {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("js-motion");
    return () => root.classList.remove("js-motion");
  }, []);
  return null;
}

/**
 * Reveal-on-scroll wrapper. Content is always in the DOM (SEO-safe); we only
 * transition opacity/translateY once it scrolls into view. `delay` staggers
 * siblings. Renders as `as` (default div) so it can be a list item, section, …
 */
export function Reveal({
  children,
  as: Tag = "div",
  delay = 0,
  className,
  ...rest
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // If already in view (or IO unsupported), reveal immediately.
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.add("is-visible");
            io.unobserve(el);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      data-reveal=""
      className={className}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
