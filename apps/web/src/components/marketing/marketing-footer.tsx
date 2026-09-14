import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandMark } from "../brand-mark";
import { Reveal } from "./motion";

/**
 * Footer link groups — kept SMALL and grounded only in pages that actually
 * exist in this product (§6-c: "لا تخترع روابط"). No "الشركة" group (no real
 * about/careers page), no app-store badges (Rasid is a PWA, not a store
 * listing), no "install" link (no dedicated install-instructions page/flow
 * exists yet to send it to — inventing one here would be exactly the kind of
 * fabricated destination this section is required to avoid).
 */
const FOOTER_GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "المنتج",
    links: [
      { href: "/pricing", label: "الأسعار" },
      { href: "/#how-it-works", label: "كيف يعمل" },
      { href: "/#features", label: "المزايا" },
      { href: "/faq", label: "الأسئلة الشائعة" },
    ],
  },
  {
    title: "المساعدة",
    links: [{ href: "/support", label: "الدعم وتواصل معنا" }],
  },
  {
    title: "القانونية",
    links: [
      { href: "/privacy", label: "سياسة الخصوصية" },
      { href: "/terms", label: "الشروط والأحكام" },
    ],
  },
];

/**
 * Closing experience for the marketing shell — a distinct, deliberately-dark
 * surface (`bg-shell`, the same "always dark in both themes" token the app
 * sidebar uses — a calm, confident ending, not pure black, and not just
 * another `bg-surface-sunken` section indistinguishable from the rest of the
 * page). Grouped links with real hover/focus affordance, a compact brand
 * block, and a clearly separated legal line. Reveals gently on scroll with a
 * light stagger across the groups, reusing the site's existing motion system.
 */
export function MarketingFooter() {
  return (
    <footer className="border-t border-shell-border bg-shell text-shell-text-muted">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-[1.2fr_2fr]">
          <Reveal as="div">
            <BrandMark tone="onDark" size="sm" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-shell-text-muted">
              راصد يمسك تشغيل مجموعاتك، ويُظهر لك ما يحتاج متابعة قبل أن يفوتك.
            </p>
          </Reveal>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_GROUPS.map((group, i) => (
              <Reveal as="div" key={group.title} delay={i * 80}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.05em] text-shell-text-muted">{group.title}</h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="focus-ring group inline-flex items-center gap-1.5 rounded-md text-sm text-shell-text transition-colors hover:text-shell-accent"
                      >
                        <span>{link.label}</span>
                        <ArrowLeft
                          aria-hidden
                          className="h-3.5 w-3.5 -translate-x-0.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal as="div" delay={160} className="mt-12 flex flex-col gap-3 border-t border-shell-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-shell-text-muted">© {new Date().getFullYear()} راصد. جميع الحقوق محفوظة.</p>
          <p className="text-xs text-shell-text-muted">سجّل ← افهم ← تصرّف ← تابع</p>
        </Reveal>
      </div>
    </footer>
  );
}
