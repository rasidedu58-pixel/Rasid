import Link from "next/link";
import { BrandMark } from "../brand-mark";

const FOOTER_LINKS = [
  { href: "/pricing", label: "الأسعار" },
  { href: "/faq", label: "الأسئلة الشائعة" },
  { href: "/support", label: "الدعم" },
  { href: "/privacy", label: "سياسة الخصوصية" },
  { href: "/terms", label: "الشروط والأحكام" },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-surface-sunken">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <BrandMark size="sm" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-text-secondary">
              راصد يمسك تشغيل مجموعاتك، ويُظهر لك ما يحتاج متابعة قبل أن يفوتك.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-3">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="focus-ring rounded-md text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-tertiary">© {new Date().getFullYear()} راصد. جميع الحقوق محفوظة.</p>
          <p className="text-xs text-text-tertiary">سجّل ← افهم ← تصرّف ← تابع</p>
        </div>
      </div>
    </footer>
  );
}
