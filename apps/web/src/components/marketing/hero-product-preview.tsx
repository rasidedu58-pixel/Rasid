"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ClipboardCheck, Wallet } from "lucide-react";
import { TiltCard } from "./anim";
import { useTheme } from "../../lib/theme-provider";

/**
 * A REAL, high-resolution screenshot captured from inside Rasid's own
 * Dashboard (the "مركز الإجراءات" daily command center) — not a mockup.
 *
 * Theme-aware wiring (§3-a): the frame picks its source from the live theme
 * via `useTheme()`. There is currently only ONE real capture in the repo
 * (`/hero-dashboard.png`, dark theme) — no real light-theme capture exists
 * yet, and per this project's standing rule a mock must never stand in for
 * one. So `LIGHT_SRC` deliberately points at the same dark asset for now
 * (a real light shot would look wrong on a light page — this is a known,
 * disclosed limitation, not a bug) — swapping in a genuine light-theme
 * capture later is a ONE-LINE change here, nothing else in this component
 * (or its callers) needs to change.
 */
const DARK_SRC = "/hero-dashboard.png";
// TODO(design): replace with a real light-theme capture of the same dashboard
// view once one exists (see docs/OFFLINE_FIRST_PWA_STATUS.md / landing polish
// report). Intentionally NOT a mock.
const LIGHT_SRC = "/hero-dashboard.png";

export function HeroProductPreview() {
  const { theme } = useTheme();
  const src = theme === "light" ? LIGHT_SRC : DARK_SRC;

  const reduce = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Cinematic scroll-driven scale (§4): compact on entry → slightly larger and
  // more focused as it crosses the viewport centre → eases back down as the
  // next section takes over. Mobile gets a shorter, smaller-amplitude range
  // (kept in JS not CSS scroll-timelines — framer-motion is already a project
  // dependency; no new library for this).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(max-width: 640px)");
    setNarrow(mq.matches);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const { scrollYProgress } = useScroll({ target: wrapRef, offset: ["start 88%", "end 30%"] });
  const scale = useTransform(
    scrollYProgress,
    [0, 0.5, 1],
    narrow ? [0.95, 1.015, 0.985] : [0.92, 1.03, 0.97],
  );

  return (
    <div ref={wrapRef} className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div aria-hidden className="pointer-events-none absolute -inset-6 -z-10 bg-[radial-gradient(60%_60%_at_50%_30%,hsl(var(--brand)/0.18),transparent_70%)]" />

      {/* Floating status chips — echo two real signals visible in the shot. */}
      <div className="rasid-float pointer-events-none absolute -start-4 top-14 z-10 hidden rounded-xl border border-border bg-surface px-3 py-2 shadow-floating sm:block" style={{ animationDelay: "0.4s" }}>
        <p className="flex items-center gap-2 text-xs font-medium text-text-primary">
          <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden />
          حضور حصة اليوم سُجّل
        </p>
      </div>
      <div className="rasid-float pointer-events-none absolute -end-3 bottom-16 z-10 hidden rounded-xl border border-border bg-surface px-3 py-2 shadow-floating sm:block" style={{ animationDelay: "1.4s" }}>
        <p className="flex items-center gap-2 text-xs font-medium text-text-primary">
          <Wallet className="h-4 w-4 text-danger" aria-hidden />
          دفعة متأخرة — تذكير
        </p>
      </div>

      <TiltCard>
        <motion.div
          style={reduce ? undefined : { scale }}
          className="rasid-product-frame overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-floating"
        >
          {/*
            Framing crop (§3-b/c): the source is a full desktop dashboard
            capture (2880×1800) — shown at its natural size it reads as a
            dense, unreadable thumbnail on a ~360px phone. `object-fit: cover`
            inside a shorter aspect-ratio box crops down to the top band that
            already carries the exact story asked for — greeting, the next/
            current session, and the two most urgent "يحتاج إجراء الآن" items
            — while keeping a natural sliver of the sidebar/header for context.
            Tighter on mobile (smaller frame → needs the tightest crop to stay
            legible), fuller on desktop where the frame itself is much larger.
          */}
          <img
            src={src}
            alt="لوحة تحكم راصد — مركز الإجراءات اليومي للمعلّم: الحصة الجارية الآن، والحالات التي تحتاج إجراءً"
            width={2880}
            height={1170}
            loading="eager"
            decoding="async"
            className="block aspect-[2880/1050] w-full object-cover object-[50%_3%] sm:aspect-[2880/1250] lg:aspect-[2880/1550]"
          />
        </motion.div>
      </TiltCard>
    </div>
  );
}
