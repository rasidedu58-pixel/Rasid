"use client";

import { useEffect, useState } from "react";
import {
  OUTER_A,
  OUTER_B,
  MID_A,
  MID_B,
  ARROW_HEAD,
  ARROW_SHAFT,
  RING_STROKE,
  RASID_CENTER,
} from "../brand/rasid-geometry";

const FULL_MS = 1500;
const REDUCED_MS = 500;

/**
 * Module-level flag — reset on every FULL page load (a fresh JS execution
 * context: browser refresh, opening the app in a new tab, or any hard
 * navigation) and preserved across in-app SPA route changes (same context). So
 * the splash replays on refresh / new navigation, but never on an internal
 * route change. Deliberately NOT sessionStorage (which survives refresh and so
 * suppressed the replay).
 */
let shownThisLoad = false;

/**
 * Rasid brand-entrance splash — a ~1.5s Brand Motion Sequence shown on every FULL
 * page load (browser refresh / new tab / hard navigation), never on internal SPA
 * route changes. Gated by the module-level `shownThisLoad` flag above (which
 * resets with each fresh JS context), NOT sessionStorage — sessionStorage
 * survives a refresh and so wrongly suppressed the replay.
 *
 * Story (all CSS-timed to the same ~1.5s window; JS only mounts then unmounts):
 *   detection — rings resolve from the centre outward, centre lights up
 *   an arrow flies IN from off the lower-right, accelerating; rings lock-pulse
 *   impact — the arrow strikes the centre (and stops); flash + shockwave; the
 *            rings fracture into their segments and are pulled back into place —
 *            the strike is what FORMS the final logo (not a random explosion)
 *   settle → the "راصد" wordmark rises in → the whole mark eases up + the cover
 *   fades, revealing the page beneath.
 *
 * The final frame is byte-identical to the static RasidMark. `prefers-reduced-motion`
 * collapses this to a ~500ms logo fade (no motion, no layout shift). `?splashPreview=1`
 * replays it in dev only. Fixed overlay (no CLS), `aria-hidden` (the page is already
 * mounted beneath it).
 */
export function SplashScreen() {
  const [state, setState] = useState<"idle" | "full" | "reduced">("idle");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const devPreview = process.env.NODE_ENV !== "production" && params.get("splashPreview") === "1";

    const reduced =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!devPreview && shownThisLoad) {
      return; // already shown in THIS page load (SPA re-mount) → do not replay
    }
    shownThisLoad = true;

    if (reduced && !devPreview) {
      setState("reduced");
      const t = setTimeout(() => setState("idle"), REDUCED_MS);
      return () => clearTimeout(t);
    }

    setState("full");
    const t = setTimeout(() => setState("idle"), FULL_MS);
    return () => clearTimeout(t);
  }, []);

  if (state === "idle") return null;

  const reduced = state === "reduced";

  return (
    <div className="rasid-splash2" data-reduced={reduced || undefined} aria-hidden>
      <div className="rasid-splash2-glow" />
      <div className="rasid-splash2-stage">
        <svg
          className="rs-svg"
          width="220"
          height="220"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="rsRingG" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#3B82F6" />
              <stop offset="0.55" stopColor="#0EA5E9" />
              <stop offset="1" stopColor="#14B8A6" />
            </linearGradient>
            <linearGradient id="rsAccentG" x1="18" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#22D3EE" />
              <stop offset="1" stopColor="#38BDF8" />
            </linearGradient>
            <radialGradient id="rsCenterG" cx="0.42" cy="0.4" r="0.72">
              <stop offset="0" stopColor="#67E8F9" />
              <stop offset="0.6" stopColor="#22D3EE" />
              <stop offset="1" stopColor="#0EA5E9" />
            </radialGradient>
            <linearGradient id="rsArrowG" x1="30" y1="30" x2="52" y2="52" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#67E8F9" />
              <stop offset="1" stopColor="#2563EB" />
            </linearGradient>
          </defs>

          {/* Rings — reveal + lock-pulse + recoil live on this group; each segment
              also fractures outward then returns (per-segment direction vars). */}
          <g className="rs-rings">
            <g className="rs-seg" style={{ "--fx": "-3.2px", "--fy": "3.2px", "--fr": "4deg" } as React.CSSProperties}>
              <path d={OUTER_A} stroke="url(#rsRingG)" strokeWidth={RING_STROKE} strokeLinecap="round" />
            </g>
            <g className="rs-seg" style={{ "--fx": "3.2px", "--fy": "-3.2px", "--fr": "-4deg" } as React.CSSProperties}>
              <path d={OUTER_B} stroke="url(#rsRingG)" strokeWidth={RING_STROKE} strokeLinecap="round" />
            </g>
            <g className="rs-seg" style={{ "--fx": "-2.3px", "--fy": "2.3px", "--fr": "5deg" } as React.CSSProperties}>
              <path d={MID_A} stroke="url(#rsRingG)" strokeWidth={RING_STROKE} strokeLinecap="round" />
            </g>
            <g className="rs-seg" style={{ "--fx": "2.3px", "--fy": "-2.3px", "--fr": "-5deg" } as React.CSSProperties}>
              <path d={MID_B} stroke="url(#rsAccentG)" strokeWidth={RING_STROKE} strokeLinecap="round" />
            </g>
          </g>

          <circle className="rs-center" cx={RASID_CENTER.x} cy={RASID_CENTER.y} r={RASID_CENTER.r} fill="url(#rsCenterG)" />
          <circle className="rs-flash" cx={RASID_CENTER.x} cy={RASID_CENTER.y} r={RASID_CENTER.r} fill="#A5F3FC" />
          <circle className="rs-wave" cx={RASID_CENTER.x} cy={RASID_CENTER.y} r={RASID_CENTER.r} fill="none" stroke="#67E8F9" strokeWidth="1.4" />

          <g className="rs-particles">
            {PARTICLES.map((p, i) => (
              <circle
                key={i}
                className="rs-particle"
                cx={RASID_CENTER.x}
                cy={RASID_CENTER.y}
                r="0.85"
                fill="#67E8F9"
                style={{ "--px": `${p.x}px`, "--py": `${p.y}px`, "--pd": `${p.d}ms` } as React.CSSProperties}
              />
            ))}
          </g>

          <g className="rs-arrow">
            <path d={ARROW_HEAD} fill="url(#rsArrowG)" />
            <path d={ARROW_SHAFT} fill="url(#rsArrowG)" />
          </g>
        </svg>

        <span className="rs-word">راصد</span>
      </div>
    </div>
  );
}

// 6 impact sparks — small outward vectors (64-space), staggered a touch.
const PARTICLES = [
  { x: 13, y: -6, d: 0 },
  { x: 8, y: -13, d: 30 },
  { x: -12, y: -8, d: 10 },
  { x: -9, y: 11, d: 40 },
  { x: 12, y: 9, d: 20 },
  { x: -14, y: 2, d: 50 },
];
