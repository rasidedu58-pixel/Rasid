import type { MetadataRoute } from "next";

const SITE_URL = "https://rasid-web.vercel.app";

const PUBLIC_ROUTES = ["", "/pricing", "/faq", "/privacy", "/terms", "/support"];

/** Only genuinely public, indexable pages — private/app/platform-admin routes are deliberately excluded (see their own `robots: { index: false }` metadata). */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
