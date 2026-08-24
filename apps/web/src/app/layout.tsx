import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Arabic, Inter } from "next/font/google";
import { Toaster } from "@academic-precision/ui";
import { AppQueryProvider } from "../lib/query-provider";
import { SessionProvider } from "../lib/session-provider";
import { WorkspaceProvider } from "../lib/workspace-provider";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_URL = "https://rasid-web.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "راصد — Rasid", template: "%s" },
  description: "راصد — نظام تشغيل ومتابعة للمعلمين وأصحاب المجموعات التعليمية.",
  openGraph: {
    type: "website",
    locale: "ar_EG",
    siteName: "راصد",
    title: "راصد — نظام تشغيل ومتابعة للمدرسين وأصحاب المجموعات التعليمية",
    description: "سجّل → افهم → اتخذ إجراء → تابع. تجربة مجانية 14 يومًا بدون بطاقة.",
  },
  twitter: {
    card: "summary",
    title: "راصد — نظام تشغيل ومتابعة للمدرسين",
    description: "سجّل → افهم → اتخذ إجراء → تابع. تجربة مجانية 14 يومًا بدون بطاقة.",
  },
};

/** Root layout — Arabic-first/RTL. Providers are ordered so WorkspaceProvider can read SessionProvider's state, and AppQueryProvider wraps both (both use TanStack Query). */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} ${inter.variable}`}>
      <body className="font-sans">
        <AppQueryProvider>
          <SessionProvider>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </SessionProvider>
        </AppQueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
