import { cn } from "@academic-precision/ui";
import {
  RASID_VIEWBOX,
  RASID_CENTER,
  OUTER_A,
  OUTER_B,
  MID_A,
  MID_B,
  ARROW_HEAD,
  ARROW_SHAFT,
  RING_STROKE,
  COMPACT_A,
  COMPACT_B,
  COMPACT_RING_STROKE,
  COMPACT_CENTER_R,
  COMPACT_THRESHOLD,
} from "./rasid-geometry";

/**
 * RasidMark — the one brand mark for the whole product. Pure SVG, geometry from
 * `rasid-geometry.ts` (identical to the splash animation's final frame). No
 * hooks, so it renders in Server Components too; gradient ids are stable and
 * self-consistent, and because every instance's gradients are byte-identical,
 * sharing ids across instances renders correctly.
 *
 *   variant  "icon" (mark only) | "lockup" (mark + "راصد")
 *   size     rendered px (default 28); below COMPACT_THRESHOLD it auto-switches
 *            to the single-ring compact geometry so it stays legible at 16–24px
 *   mono     one flat `currentColor` version for tiny/constrained placements
 *   title    a11y label; when omitted the mark is decorative (aria-hidden)
 *
 * Colors are a deep-blue → sky → teal/cyan family that reads on both near-black
 * and off-white, so there is no separate light/dark asset.
 */
export interface RasidMarkProps {
  size?: number;
  variant?: "icon" | "lockup";
  mono?: boolean;
  compact?: boolean;
  className?: string;
  wordClassName?: string;
  title?: string;
}

export function RasidMark({
  size = 28,
  variant = "icon",
  mono = false,
  compact,
  className,
  wordClassName,
  title,
}: RasidMarkProps) {
  const useCompact = compact ?? size < COMPACT_THRESHOLD;
  const labelled = Boolean(title);

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={RASID_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={variant === "icon" ? className : undefined}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
    >
      {!mono ? (
        <defs>
          <linearGradient id="rasidRingG" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#3B82F6" />
            <stop offset="0.55" stopColor="#0EA5E9" />
            <stop offset="1" stopColor="#14B8A6" />
          </linearGradient>
          <linearGradient id="rasidAccentG" x1="18" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#22D3EE" />
            <stop offset="1" stopColor="#38BDF8" />
          </linearGradient>
          <radialGradient id="rasidCenterG" cx="0.42" cy="0.4" r="0.72">
            <stop offset="0" stopColor="#67E8F9" />
            <stop offset="0.6" stopColor="#22D3EE" />
            <stop offset="1" stopColor="#0EA5E9" />
          </radialGradient>
          <linearGradient id="rasidArrowG" x1="30" y1="30" x2="52" y2="52" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#67E8F9" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
      ) : null}

      {(() => {
        const ring = mono ? "currentColor" : "url(#rasidRingG)";
        const accent = mono ? "currentColor" : "url(#rasidAccentG)";
        const center = mono ? "currentColor" : "url(#rasidCenterG)";
        const arrow = mono ? "currentColor" : "url(#rasidArrowG)";
        if (useCompact) {
          return (
            <>
              <path d={COMPACT_A} stroke={ring} strokeWidth={COMPACT_RING_STROKE} strokeLinecap="round" />
              <path d={COMPACT_B} stroke={accent} strokeWidth={COMPACT_RING_STROKE} strokeLinecap="round" />
              <circle cx={RASID_CENTER.x} cy={RASID_CENTER.y} r={COMPACT_CENTER_R} fill={center} />
              <path d={ARROW_HEAD} fill={arrow} />
              <path d={ARROW_SHAFT} fill={arrow} />
            </>
          );
        }
        return (
          <>
            <path d={OUTER_A} stroke={ring} strokeWidth={RING_STROKE} strokeLinecap="round" />
            <path d={OUTER_B} stroke={ring} strokeWidth={RING_STROKE} strokeLinecap="round" />
            <path d={MID_A} stroke={ring} strokeWidth={RING_STROKE} strokeLinecap="round" />
            <path d={MID_B} stroke={accent} strokeWidth={RING_STROKE} strokeLinecap="round" />
            <circle cx={RASID_CENTER.x} cy={RASID_CENTER.y} r={RASID_CENTER.r} fill={center} />
            <path d={ARROW_HEAD} fill={arrow} />
            <path d={ARROW_SHAFT} fill={arrow} />
          </>
        );
      })()}
    </svg>
  );

  if (variant === "icon") return svg;

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {svg}
      <span className={cn("font-bold tracking-tight", wordClassName)}>راصد</span>
    </span>
  );
}
