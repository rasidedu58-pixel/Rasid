import type { MetadataRoute } from "next";

const SITE_URL = "https://rasid-web.vercel.app";

/**
 * Belt-and-suspenders alongside each private route's own per-page
 * `robots: { index: false }` metadata — this file additionally tells
 * well-behaved crawlers not to even bother requesting these paths.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/login", "/signup", "/verify-email", "/forgot-password", "/reset-password", "/onboarding", "/dashboard", "/platform-admin"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
