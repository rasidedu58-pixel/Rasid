import { cn } from "@academic-precision/ui";
import { RasidMark } from "./brand/rasid-mark";

/**
 * The one canonical Rasid brand lockup: the RasidMark (radar rings + inbound
 * arrow) + the "راصد" wordmark, identical across marketing, auth, and the app
 * shell so the whole product reads as one brand (UI-6 §17). Two tones:
 *   - "brand" (default): wordmark in text-primary — marketing header, auth form pane.
 *   - "onDark": wordmark in white — for use on a navy `bg-shell` surface.
 * `glyphOnly` renders just the mark. Sizes scale the mark + wordmark together.
 *
 * This is a thin wrapper over <RasidMark>: the mark's own colors (deep-blue →
 * teal/cyan) are tone-independent, so only the wordmark color follows `tone`.
 */
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
  const word = { sm: "text-base", md: "text-lg", lg: "text-2xl" }[size];

  if (glyphOnly) {
    return <RasidMark size={MARK_PX[size]} className={className} title="راصد" />;
  }

  return (
    <RasidMark
      variant="lockup"
      size={MARK_PX[size]}
      className={cn(className)}
      wordClassName={cn(word, tone === "onDark" ? "text-white" : "text-text-primary")}
    />
  );
}
