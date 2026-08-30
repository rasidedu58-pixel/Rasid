import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@academic-precision/ui";

/**
 * Typography System v2.0 — the single source of typographic truth.
 *
 * One family site-wide (IBM Plex Sans Arabic; Geist via `font-english` for
 * Latin/numbers). Sizes/line-heights are tuned for Arabic: emphasis comes from
 * weight + spacing, not oversized headings. Display/H1/H2/H3 read their
 * responsive sizes from the `.text-*` utilities in globals.css; the smaller
 * roles are encoded here. Every component is RTL-inheriting (dir=rtl on <html>)
 * and accepts `as` (to change the element) and `className` (to extend).
 *
 * Colors follow the system: headings = text-primary, body = text-secondary,
 * captions = text-tertiary, overline = brand. Override via className when a
 * surface needs a different tone.
 */
interface TypographyProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
}

function makeTypography(defaultTag: ElementType, base: string) {
  function Typography({ as, className, children, ...rest }: TypographyProps) {
    const Tag = as ?? defaultTag;
    return (
      <Tag className={cn(base, className)} {...rest}>
        {children}
      </Tag>
    );
  }
  return Typography;
}

/** Hero headline only (~48px desktop). */
export const Display = makeTypography("h1", "text-display text-text-primary");
/** Primary section heading (~40px). */
export const H1 = makeTypography("h1", "text-h1 text-text-primary");
/** Section heading (~32px). */
export const H2 = makeTypography("h2", "text-h2 text-text-primary");
/** Card / sub-section heading (~24px). */
export const H3 = makeTypography("h3", "text-h3 text-text-primary");
/** In-card heading (~20px). */
export const H4 = makeTypography("h4", "text-xl font-semibold leading-[1.4] text-text-primary");
/** Section lead / description (18px, roomy Arabic line-height). */
export const BodyLarge = makeTypography("p", "text-lg leading-[1.85] text-text-secondary");
/** Default body (16px). */
export const Body = makeTypography("p", "text-base leading-[1.8] text-text-secondary");
/** Helper / labels (14px). */
export const BodySmall = makeTypography("p", "text-sm font-medium leading-[1.6] text-text-secondary");
/** Metadata / dates (13px). */
export const Caption = makeTypography("span", "text-[0.8125rem] font-medium leading-[1.5] text-text-tertiary");
/** Eyebrow / overline label above a heading (12px, tracked, brand). */
export const Overline = makeTypography("span", "text-xs font-semibold uppercase tracking-[0.05em] text-brand");
