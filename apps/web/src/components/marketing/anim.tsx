"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  animate,
} from "framer-motion";

/**
 * A subtle pointer-driven 3D tilt for the hero product mockup. Spring-damped,
 * disabled under prefers-reduced-motion, and inert on touch (no pointer). The
 * content is always rendered (SEO-safe); this only adds transform.
 */
export function TiltCard({ children, className, max = 6 }: { children: ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [max, -max]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-max, max]), { stiffness: 150, damping: 18 });

  function onMove(e: ReactPointerEvent) {
    if (reduce || e.pointerType === "touch") return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  }
  function reset() {
    px.set(0);
    py.set(0);
  }

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      style={{ rotateX, rotateY, transformPerspective: 1200, transformStyle: "preserve-3d" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/**
 * Count-up number, triggered once when scrolled into view. `format` renders the
 * live value (e.g. add a suffix). Static final value under reduced-motion.
 */
export function Counter({
  to,
  duration = 1.4,
  className,
  format = (n: number) => Math.round(n).toLocaleString("ar-EG"),
}: {
  to: number;
  duration?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const [display, setDisplay] = useState(() => format(reduce ? to : 0));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisplay(format(to));
      return;
    }
    const controls = animate(0, to, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(format(v)),
    });
    return () => controls.stop();
  }, [inView, to, duration, reduce, format]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
