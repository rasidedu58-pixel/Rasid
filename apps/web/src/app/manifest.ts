import type { MetadataRoute } from "next";

/**
 * PWA manifest (served at /manifest.webmanifest and auto-linked by Next). Icons
 * are the Rasid radar mark: a full-bleed "any" SVG and a padded, opaque-backed
 * "maskable" SVG so Android's adaptive mask never clips the arrow tail.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "راصد — نظام تشغيل ومتابعة للمجموعات التعليمية",
    short_name: "راصد",
    description: "سجّل → افهم → اتخذ إجراء → تابع.",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0A0F",
    theme_color: "#08090e",
    icons: [
      { src: "/icon-any.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
