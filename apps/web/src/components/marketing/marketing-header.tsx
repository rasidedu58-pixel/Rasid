"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@academic-precision/ui";
import { BrandMark } from "../brand-mark";

const NAV_LINKS = [
  { href: "/#features", label: "المزايا", section: "features" },
  { href: "/#how-it-works", label: "كيف يعمل", section: "how-it-works" },
  { href: "/#pricing", label: "الأسعار", section: "pricing" },
  { href: "/faq", label: "الأسئلة الشائعة", section: null },
];

/** Public marketing header — sticky, elevates on scroll, and (on the landing page) highlights the section currently in view. */
export function MarketingHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);

  // Elevate the header once the page is scrolled past the hero top.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Active-section tracking — landing page only (where the anchor sections exist).
  useEffect(() => {
    if (pathname !== "/") {
      setActiveSection(null);
      return;
    }
    const ids = NAV_LINKS.map((l) => l.section).filter(Boolean) as string[];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActiveSection(visible[0].target.id);
      },
      { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.25, 0.5] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pathname]);

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,box-shadow,border-color] duration-300 ${
        scrolled ? "border-border bg-surface/80 shadow-sm backdrop-blur-md" : "border-transparent bg-surface/50 backdrop-blur"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="راصد — الصفحة الرئيسية" className="focus-ring rounded-md">
          <BrandMark size="sm" />
        </Link>

        <nav className="absolute inset-x-0 mx-auto hidden w-fit items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => {
            const isActive = link.section !== null && pathname === "/" && activeSection === link.section;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary"
                }`}
                aria-current={isActive ? "true" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
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
          className="focus-ring flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:text-text-primary md:hidden"
          aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
          aria-expanded={open}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </div>

      {/* Mobile menu — animated open/close via the grid-rows technique. */}
      <div className="rasid-accordion-panel md:hidden" data-open={open}>
        <div className="rasid-accordion-inner">
          <div className="flex flex-col gap-1 border-t border-border bg-surface px-4 py-3">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2.5 text-sm text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
              <Button asChild variant="outline" size="sm" className="justify-center">
                <Link href="/login" onClick={() => setOpen(false)}>
                  تسجيل الدخول
                </Link>
              </Button>
              <Button asChild size="sm" className="justify-center">
                <Link href="/signup" onClick={() => setOpen(false)}>
                  ابدأ تجربتك المجانية
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
