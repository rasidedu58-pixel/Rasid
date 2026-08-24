import Link from "next/link";

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
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <span className="text-lg font-bold text-brand">راصد</span>
            <p className="mt-1 max-w-xs text-sm text-text-secondary">نظام تشغيل ومتابعة للمدرسين وأصحاب المجموعات التعليمية.</p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            {FOOTER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-sm text-text-secondary hover:text-text-primary">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <p className="text-xs text-text-tertiary">© {new Date().getFullYear()} راصد. جميع الحقوق محفوظة.</p>
      </div>
    </footer>
  );
}
