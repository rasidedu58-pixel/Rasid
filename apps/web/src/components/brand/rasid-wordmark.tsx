import { cn } from "@academic-precision/ui";
import { RasidMark } from "./rasid-mark";

/**
 * RasidWordmark — the ONE canonical brand lockup (mark + "راصد"). Every place
 * that shows the brand name next to the mark should use this instead of
 * hand-rolling `<RasidMark/> راصد`, so the icon↔word ratio, gap, weight and
 * colour stay identical everywhere (marketing, auth, app shell, platform admin,
 * mobile nav). `BrandMark` delegates here too.
 *
 *   variant  compact (28px) | default (32px) | large (44px)
 *   tone     default (text-primary word) | onDark (white word, for navy shells)
 *
 * The word uses the app's Arabic face (IBM Plex Sans Arabic), bold + tight
 * tracking — modern and minimal, never calligraphic.
 */
const SIZE_PX = { compact: 28, default: 32, large: 44 } as const;
const WORD_CLASS = { compact: "text-base", default: "text-lg", large: "text-2xl" } as const;

export type RasidWordmarkVariant = keyof typeof SIZE_PX;

export function RasidWordmark({
  variant = "default",
  tone = "default",
  className,
  wordClassName,
}: {
  variant?: RasidWordmarkVariant;
  tone?: "default" | "onDark";
  className?: string;
  wordClassName?: string;
}) {
  return (
    <RasidMark
      variant="lockup"
      size={SIZE_PX[variant]}
      className={className}
      wordClassName={cn(WORD_CLASS[variant], tone === "onDark" ? "text-white" : "text-text-primary", wordClassName)}
    />
  );
}
