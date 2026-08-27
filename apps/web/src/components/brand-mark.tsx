import { cn } from "@academic-precision/ui";

/**
 * The one canonical Rasid brand lockup: the "ر" glyph chip + "راصد"
 * wordmark, identical in language to the authenticated shell's sidebar
 * lockup (see components/shell/sidebar.tsx) so marketing, auth, and the app
 * read as one product (UI-6 §17). Two tones:
 *   - "brand" (default): teal chip on a light surface — marketing header, auth form pane.
 *   - "onDark": the exact shell treatment — for use on a navy `bg-shell` surface.
 * `glyphOnly` renders just the chip (compact contexts). Sizes scale the chip
 * and wordmark together.
 */
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
  const chip = {
    sm: "h-7 w-7 rounded-md text-[13px]",
    md: "h-8 w-8 rounded-lg text-[15px]",
    lg: "h-11 w-11 rounded-xl text-xl",
  }[size];
  const word = {
    sm: "text-base",
    md: "text-lg",
    lg: "text-2xl",
  }[size];

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center font-bold",
          chip,
          tone === "onDark" ? "bg-shell-active text-shell-active-text" : "bg-brand text-brand-foreground",
        )}
        aria-hidden
      >
        ر
      </span>
      {glyphOnly ? null : (
        <span className={cn("font-bold tracking-tight", word, tone === "onDark" ? "text-white" : "text-text-primary")}>راصد</span>
      )}
    </span>
  );
}
