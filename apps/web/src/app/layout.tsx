import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Academic Precision — Web",
  description: "Academic Precision — Teacher V1 (Phase 0 foundation)",
};

/**
 * Root layout — Arabic-first/RTL shell. This is infrastructure only: no
 * product design system/branding is invented here since design references
 * are not yet in the repository.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
