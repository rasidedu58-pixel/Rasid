import { resolve } from "node:path";

/**
 * Bundled Arabic font descriptors (Tajawal, OFL-1.1) for the PDF renderer.
 * NOTE: this module must NOT statically import @react-pdf/renderer — that
 * package is ESM-only, so a static import would poison the CJS module graph
 * (breaking `require` on older Node and under jest). The renderer loads
 * @react-pdf via a native dynamic import and registers these descriptors there.
 *
 * Paths resolve relative to this file so they work from src (tests) and from
 * dist at runtime (nest-cli copies reports/assets/** to dist — see nest-cli.json).
 */
const FONT_DIR = resolve(__dirname, "../assets/fonts");

export const REPORT_PDF_FONT = "Tajawal";

export const REPORT_FONT_DESCRIPTORS = [
  { src: resolve(FONT_DIR, "Tajawal-Regular.ttf"), fontWeight: 400 },
  { src: resolve(FONT_DIR, "Tajawal-Medium.ttf"), fontWeight: 500 },
  { src: resolve(FONT_DIR, "Tajawal-Bold.ttf"), fontWeight: 700 },
] as const;
