"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@academic-precision/ui";
import { BrandMark } from "../brand-mark";

const NAV_LINKS = [
  { href: "/#features", label: "المزايا" },
  { href: "/#how-it-works", label: "كيف يعمل" },
  { href: "/pricing", label: "الأسعار" },
  { href: "/faq", label: "الأسئلة الشائعة" },
];

/** Public marketing header — separate from the authenticated `AppShell`, deliberately simpler (no workspace/user context to render). */
export function MarketingHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="راصد — الصفحة الرئيسية">
          <BrandMark size="sm" />
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-sm text-text-secondary transition-colors hover:text-text-primary">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">تسجيل الدخول</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">ابدأ تجربتك المجانية</Link>
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary md:hidden"
          aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </div>

      {open ? (
        <div className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2 text-sm text-text-secondary hover:bg-surface-sunken">
              {link.label}
            </Link>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/login">تسجيل الدخول</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">ابدأ تجربتك المجانية</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
