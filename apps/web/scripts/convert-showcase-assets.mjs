/**
 * One-off asset converter: takes the 10 raw PNG screenshots the human
 * captured from the live authenticated demo workspace and produces the
 * 10 WebP files the Product Showcase component references. NOT a build
 * step — a one-shot script run manually after new captures are dropped
 * into demo-screens/. Uses `sharp` (already present as a transitive dep
 * of Next.js / next/image in this repo — no new install).
 *
 * Ordering discovered from the actual captures — the human took Dashboard
 * light-then-dark, then Sessions dark-then-light, so the mapping below
 * pairs each source file with its slide+theme deliberately, not by name.
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "..", "..", "demo-screens");
const OUT_DIR = join(__dirname, "..", "public", "marketing", "product");

/** [source basename, target basename] pairs — order matches the order the
 * screenshots were captured, mapped to the 5 slides × 2 themes. */
const MAPPING = [
  ["Screenshot 2026-09-15 081512.png", "dashboard-light.webp"],
  ["Screenshot 2026-09-15 081559.png", "dashboard-dark.webp"],
  ["Screenshot 2026-09-15 081649.png", "sessions-dark.webp"],
  ["Screenshot 2026-09-15 081714.png", "sessions-light.webp"],
  ["Screenshot 2026-09-15 081757.png", "followups-dark.webp"],
  ["Screenshot 2026-09-15 081816.png", "followups-light.webp"],
  ["Screenshot 2026-09-15 081840.png", "students-dark.webp"],
  ["Screenshot 2026-09-15 081902.png", "students-light.webp"],
  ["Screenshot 2026-09-15 082035.png", "finance-dark.webp"],
  ["Screenshot 2026-09-15 082103.png", "finance-light.webp"],
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const [src, dst] of MAPPING) {
    const inPath = join(SRC_DIR, src);
    const outPath = join(OUT_DIR, dst);
    // The raw captures are ~2530×1230 (native laptop resolution). Resize
    // to a marketing-appropriate 1800px wide (still 2× the largest
    // displayed size for retina crispness) and encode as WebP quality 82
    // — matches the typical marketing image bytes/quality tradeoff.
    const info = await sharp(inPath)
      .resize({ width: 1800, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(outPath);
    console.log(`${src} → ${dst}  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(1)} KB`);
  }
  console.log(`\nDone. Wrote ${MAPPING.length} WebP files to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
