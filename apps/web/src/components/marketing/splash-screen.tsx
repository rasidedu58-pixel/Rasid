"use client";

import { useEffect, useState } from "react";

const SEEN_KEY = "rasid_splash_seen";

/**
 * UI-8 splash — a short (~1.4s) brand intro shown on the FIRST landing-page
 * load of a tab, then never again for that session (sessionStorage-gated), so
 * internal navigation never re-triggers it. Full-viewport off-white cover with
 * the "ر" brand glyph doing a gentle scale + blur→sharp entrance, a faint
 * radar pulse (a nod to "راصد" = observer), then the wordmark, then a soft
 * fade-out. No spinner. `prefers-reduced-motion` and repeat visits skip
 * straight to the page with no cover.
 *
 * It is a fixed overlay (never affects layout → no CLS) and `aria-hidden`
 * (decorative; the real content is already rendered beneath it for a11y/SEO).
 */
export function SplashScreen() {
  // Start hidden so SSR + first client render match (no hydration mismatch)
  // and repeat/reduced-motion visitors never see a cover. The very first
  // eligible visit flips it on in the effect below, before the browser paints.
  const [phase, setPhase] = useState<"idle" | "showing" | "leaving">("idle");

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // sessionStorage can throw (private mode); treat as first visit.
    }
    const reduced =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (seen || reduced) {
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      return; // never show — page is already visible beneath
    }

    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
    setPhase("showing");
    const leave = setTimeout(() => setPhase("leaving"), 1400);
    const done = setTimeout(() => setPhase("idle"), 1900);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
    };
  }, []);

  if (phase === "idle") return null;

  return (
    <div className="rasid-splash" data-leaving={phase === "leaving"} aria-hidden>
      <div className="flex flex-col items-center gap-5">
        <span className="rasid-splash-glyph rasid-splash-radar relative flex h-16 w-16 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-brand-foreground shadow-floating">
          ر
        </span>
        <span className="rasid-splash-word text-xl font-bold tracking-tight text-text-primary">
          راصد
        </span>
      </div>
    </div>
  );
}
