import { RasidMark } from "./brand/rasid-mark";
import { RasidWordmark } from "./brand/rasid-wordmark";

/**
 * The canonical Rasid brand lockup for marketing/auth/app shells. Thin wrapper
 * over the unified <RasidWordmark> (mark + "راصد") so every surface renders the
 * SAME lockup. `glyphOnly` renders just the mark. Two tones map to the
 * wordmark's word colour: "brand" → text-primary, "onDark" → white.
 */
const VARIANT = { sm: "compact", md: "default", lg: "large" } as const;
const MARK_PX = { sm: 28, md: 32, lg: 44 } as const;

export function BrandMark({
  tone = "brand",
  size = "md",
  glyphOnly = false,
  className,
}: {
  tone?: "brand" | "onDark";
  size?: "sm" | "md" | "lg";
  glyphOnly?: boolean;
  className?: string;
}) {
  if (glyphOnly) {
    return <RasidMark size={MARK_PX[size]} className={className} title="راصد" />;
  }
  return <RasidWordmark variant={VARIANT[size]} tone={tone === "onDark" ? "onDark" : "default"} className={className} />;
}
