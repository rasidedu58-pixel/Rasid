/**
 * Product Showcase slide config (Marketing Demo + Product Showcase
 * initiative, §G) — explicit data, not hardcoded strings scattered through
 * component JSX.
 *
 * All ten slides are REAL screenshots captured from inside the marketing
 * demo workspace (`pnpm demo:marketing:seed`) — a live authenticated
 * session against a real production database, not a mock UI. Both Light
 * and Dark themes are captured for every screen (§K). WebP encoded at
 * quality 82, 1800px wide (~40 KB each — smaller than the original hero
 * PNG combined for all 10). Sources: `demo-screens/*.png`. Converter:
 * `apps/web/scripts/convert-showcase-assets.mjs`.
 */

export type ProductShowcaseSlideId = "dashboard" | "sessions" | "students" | "followups" | "finance";

export interface ProductShowcaseSlide {
  id: ProductShowcaseSlideId;
  /** Short tab/dot label. */
  label: string;
  /** One-line headline for the slide. */
  title: string;
  /** One or two short sentences — never a paragraph. */
  description: string;
  lightSrc: string;
  darkSrc: string;
  alt: string;
}

const BASE = "/marketing/product";

export const PRODUCT_SHOWCASE_SLIDES: ProductShowcaseSlide[] = [
  {
    id: "dashboard",
    label: "الرئيسية",
    title: "اعرف ما يحتاج انتباهك الآن",
    description: "الجلسة القادمة والمتابعات والتنبيهات في مكان واحد.",
    lightSrc: `${BASE}/dashboard-light.webp`,
    darkSrc: `${BASE}/dashboard-dark.webp`,
    alt: "لوحة راصد الرئيسية — الحصة الجارية الآن، وما يحتاج إجراء",
  },
  {
    id: "sessions",
    label: "الحصص",
    title: "أدر الجلسة والحضور بسهولة",
    description: "سجّل الحضور والواجب من هاتفك أثناء الحصة نفسها — بلا دفاتر.",
    lightSrc: `${BASE}/sessions-light.webp`,
    darkSrc: `${BASE}/sessions-dark.webp`,
    alt: "شاشة الحصة والحضور في راصد — قائمة الطلاب وحالات الحضور",
  },
  {
    id: "students",
    label: "الطلاب",
    title: "طلابك ومجموعاتك في مكان واحد",
    description: "كل مجموعة بجدولها وتحصيلها وطلابها، ولا سجل يضيع بين الشهور.",
    lightSrc: `${BASE}/students-light.webp`,
    darkSrc: `${BASE}/students-dark.webp`,
    alt: "شاشة المجموعة في راصد — الطلاب المسجّلون والتحصيل الشهري",
  },
  {
    id: "followups",
    label: "المتابعة",
    title: "لا تدع متابعة تسقط منك",
    description: "ملف كل طالب بحضوره وواجباته وحالته المالية أمامك في لحظة.",
    lightSrc: `${BASE}/followups-light.webp`,
    darkSrc: `${BASE}/followups-dark.webp`,
    alt: "ملف الطالب في راصد — الحضور والواجب والامتحان والمتبقّي المالي",
  },
  {
    id: "finance",
    label: "المالية",
    title: "اعرف المدفوع والمتبقي بوضوح",
    description: "مستحقات كل طالب وسجل دفعاته، والمتأخر منها، بلا حساب يدوي.",
    lightSrc: `${BASE}/finance-light.webp`,
    darkSrc: `${BASE}/finance-dark.webp`,
    alt: "شاشة المالية في راصد — المستحقات والدفعات والمتأخرات",
  },
];

/** Pure theme→asset selection, factored out so it's unit-testable without
 * rendering `next/image` (which needs a real Next runtime for its loader). */
export function pickShowcaseSrc(theme: "light" | "dark", slide: ProductShowcaseSlide): string {
  return theme === "light" ? slide.lightSrc : slide.darkSrc;
}
