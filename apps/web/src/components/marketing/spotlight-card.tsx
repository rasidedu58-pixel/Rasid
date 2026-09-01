"use client";

import { useRef, type ReactNode } from "react";

/**
 * Local pointer-response wrapper for a feature/persona/trust card. Tracks the
 * cursor ONLY within this element (no global mousemove listener) and writes
 * --mx/--my so the `.spotlight-glow` radial follows the pointer. Desktop fine
 * pointers only (the CSS gates on `hover:hover and pointer:fine`); touch never
 * triggers it. The card's own hover lift/border stays; this adds the highlight.
 */
export function SpotlightCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    // Ignore coarse pointers (touch/pen) — pointer effects are desktop-only.
    if (e.pointerType !== "mouse") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }

  return (
    <div ref={ref} onPointerMove={onMove} className={`spotlight-card relative isolate h-full ${className ?? ""}`}>
      {children}
      <span aria-hidden className="spotlight-glow" />
    </div>
  );
}
