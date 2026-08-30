/**
 * Rasid brand mark — the single geometric source of truth.
 *
 * Concept: concentric radar rings (segmented, with gaps on the lower-right and
 * upper-left) + an inbound arrow that travels from OUTSIDE the rings, through
 * the lower-right gap, into the CENTER — never outward. It reads as
 * رصد → تحديد → إصابة الهدف (detect → target → strike).
 *
 * All coordinates live in a fixed 64×64 viewBox centred at (32,32). Every path
 * here was produced by scripts/gen (pure trig, gaps at 45°/225°, half-width 20°)
 * and hard-coded so the SVG is byte-identical on server and client (no runtime
 * float drift → no hydration mismatch). The RasidMark component and the splash
 * animation share these exact paths so the animated and static logos match
 * frame-for-frame.
 */
export const RASID_VIEWBOX = "0 0 64 64";
export const RASID_CENTER = { x: 32, y: 32, r: 6.5 } as const;

// Full mark — two rings, each split into an A (upper-left) and B (lower-right)
// segment by the two gaps. Segment B is the "locked-on" side the arrow enters.
export const OUTER_A = "M 42.565 54.658 A 25 25 0 0 1 9.342 21.435";
export const OUTER_B = "M 21.435 9.342 A 25 25 0 0 1 54.658 42.565";
export const MID_A = "M 38.973 46.954 A 16.5 16.5 0 0 1 17.046 25.027";
export const MID_B = "M 25.027 17.046 A 16.5 16.5 0 0 1 46.954 38.973";
export const RING_STROKE = 3.4;

// Arrow — head triangle + shaft, tip resting inside the centre, tail outside
// toward the lower-right. Drawn as two shapes with the same fill.
export const ARROW_HEAD = "M 30.586 30.586 L 33.768 45.789 L 45.789 33.768 Z";
export const ARROW_SHAFT = "M 35.253 39.354 L 48.334 52.435 L 52.435 48.334 L 39.354 35.253 Z";
export const ARROW_TIP = { x: 30.586, y: 30.586 } as const;

// Compact mark — a single (bolder) ring + larger centre + the same arrow, for
// ≤ ~24px (favicon, collapsed rails) where two thin rings would merge to mush.
export const COMPACT_A = "M 40.875 51.032 A 21 21 0 0 1 12.968 23.125";
export const COMPACT_B = "M 23.125 12.968 A 21 21 0 0 1 51.032 40.875";
export const COMPACT_RING_STROKE = 4.6;
export const COMPACT_CENTER_R = 8;

/** Below this rendered px the mark switches to the compact (single-ring) geometry. */
export const COMPACT_THRESHOLD = 26;
