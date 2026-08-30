import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { Toaster } from "@academic-precision/ui";
import { AppQueryProvider } from "../lib/query-provider";
import { SessionProvider } from "../lib/session-provider";
import { WorkspaceProvider } from "../lib/workspace-provider";
import { ThemeProvider } from "../lib/theme-provider";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-arabic",
  display: "swap",
});


/**
 * Applied before paint so the persisted theme choice never flashes. Defaults
 * to dark (Design System v2 is dark-first); only an explicit "light" choice
 * switches. Kept as a tiny inline string on purpose.
 */
const NO_FLASH_THEME = `try{var t=localStorage.getItem('rasid-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){document.documentElement.setAttribute('data-theme','dark')}`;

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
    <html lang="ar" dir="rtl" data-theme="dark" suppressHydrationWarning className={`${plexArabic.variable} ${GeistSans.variable}`}>
      <body className="font-sans">
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME }} />
        <ThemeProvider>
          <AppQueryProvider>
            <SessionProvider>
              <WorkspaceProvider>{children}</WorkspaceProvider>
            </SessionProvider>
          </AppQueryProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
