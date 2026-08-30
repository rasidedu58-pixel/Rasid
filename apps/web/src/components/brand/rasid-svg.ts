import {
  OUTER_A,
  OUTER_B,
  MID_A,
  MID_B,
  ARROW_HEAD,
  ARROW_SHAFT,
  RING_STROKE,
  RASID_CENTER,
  COMPACT_A,
  COMPACT_B,
  COMPACT_RING_STROKE,
  COMPACT_CENTER_R,
} from "./rasid-geometry";

/**
 * Server-side string builder for the Rasid mark — the single source for every
 * generated asset (favicon SVG, PWA icons, apple-touch, OpenGraph). Same
 * geometry as the <RasidMark> React component, so all surfaces match.
 *
 *   compact  single-ring geometry (favicon / tiny)
 *   bg       optional solid background (e.g. maskable/apple need an opaque fill)
 *   pad      inset the mark by this fraction of the box on every side
 *            (maskable safe area — keep the arrow tail off the edges)
 */
export function rasidMarkSvg(opts: { compact?: boolean; bg?: string; pad?: number; size?: number } = {}): string {
  const { compact = false, bg, pad = 0, size = 64 } = opts;
  const defs = `
    <linearGradient id="rRing" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#3B82F6"/><stop offset="0.55" stop-color="#0EA5E9"/><stop offset="1" stop-color="#14B8A6"/>
    </linearGradient>
    <linearGradient id="rAccent" x1="18" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#38BDF8"/>
    </linearGradient>
    <radialGradient id="rCenter" cx="0.42" cy="0.4" r="0.72">
      <stop offset="0" stop-color="#67E8F9"/><stop offset="0.6" stop-color="#22D3EE"/><stop offset="1" stop-color="#0EA5E9"/>
    </radialGradient>
    <linearGradient id="rArrow" x1="30" y1="30" x2="52" y2="52" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#67E8F9"/><stop offset="1" stop-color="#2563EB"/>
    </linearGradient>`;

  const mark = compact
    ? `
      <path d="${COMPACT_A}" stroke="url(#rRing)" stroke-width="${COMPACT_RING_STROKE}" stroke-linecap="round"/>
      <path d="${COMPACT_B}" stroke="url(#rAccent)" stroke-width="${COMPACT_RING_STROKE}" stroke-linecap="round"/>
      <circle cx="${RASID_CENTER.x}" cy="${RASID_CENTER.y}" r="${COMPACT_CENTER_R}" fill="url(#rCenter)"/>
      <path d="${ARROW_HEAD}" fill="url(#rArrow)"/>
      <path d="${ARROW_SHAFT}" fill="url(#rArrow)"/>`
    : `
      <path d="${OUTER_A}" stroke="url(#rRing)" stroke-width="${RING_STROKE}" stroke-linecap="round"/>
      <path d="${OUTER_B}" stroke="url(#rRing)" stroke-width="${RING_STROKE}" stroke-linecap="round"/>
      <path d="${MID_A}" stroke="url(#rRing)" stroke-width="${RING_STROKE}" stroke-linecap="round"/>
      <path d="${MID_B}" stroke="url(#rAccent)" stroke-width="${RING_STROKE}" stroke-linecap="round"/>
      <circle cx="${RASID_CENTER.x}" cy="${RASID_CENTER.y}" r="${RASID_CENTER.r}" fill="url(#rCenter)"/>
      <path d="${ARROW_HEAD}" fill="url(#rArrow)"/>
      <path d="${ARROW_SHAFT}" fill="url(#rArrow)"/>`;

  const scale = 1 - pad * 2;
  const offset = (64 * pad).toFixed(3);
  const inner = pad > 0 ? `<g transform="translate(${offset} ${offset}) scale(${scale})">${mark}</g>` : mark;
  const bgRect = bg ? `<rect width="64" height="64" rx="14" fill="${bg}"/>` : "";

  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><defs>${defs}</defs>${bgRect}${inner}</svg>`;
}

/** base64 data-URI form, for embedding as <img> inside next/og ImageResponse. */
export function rasidMarkDataUri(opts?: Parameters<typeof rasidMarkSvg>[0]): string {
  const svg = rasidMarkSvg(opts);
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(svg).toString("base64") : btoa(svg);
  return `data:image/svg+xml;base64,${b64}`;
}
