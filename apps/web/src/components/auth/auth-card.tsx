import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "../brand-mark";

/** The operating rhythm Rasid is built around — the same four verbs the product story uses everywhere. */
const PILLARS: Array<{ verb: string; line: string }> = [
  { verb: "سجّل", line: "الحضور والواجب والدرجة من الهاتف أثناء الحصة." },
  { verb: "افهم", line: "ما يحتاج قرارك الآن يظهر وحده، دون بحث." },
  { verb: "تصرّف", line: "تذكير بدفعة، متابعة حالة، إكمال سجل ناقص." },
  { verb: "تابع", line: "صورة كاملة عن كل طالب وشهر وقتما احتجتها." },
];

/**
 * Shared visual shell for every public auth page (login / signup / verify /
 * forgot / reset). UI-6: replaced the old generic centered shadcn card with
 * a branded split experience — a deep-navy brand pane (the same `--shell-*`
 * identity as the authenticated app) carrying Rasid's operating rhythm, next
 * to a calm, focused form pane. The pane itself is the surface, so the form
 * no longer floats in a lone box. On mobile the brand pane collapses to a
 * compact brand mark above the form. The `{title, description, children,
 * footer}` API is unchanged — every auth page inherits this automatically.
 */
export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      {/* Form pane — first in DOM so it sits on the start (right) side in RTL. */}
      <div className="flex flex-col items-center justify-center bg-surface px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          {/* Brand mark: shown here on mobile/tablet where the brand pane is hidden. */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Link href="/" aria-label="راصد — الصفحة الرئيسية">
              <BrandMark size="md" />
            </Link>
          </div>

          <div className="mb-6 flex flex-col gap-1.5">
            <h1 className="text-xl font-bold text-text-primary sm:text-2xl">{title}</h1>
            {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
          </div>

          {children}

          {footer ? <div className="mt-6 text-center text-sm text-text-secondary">{footer}</div> : null}
        </div>
      </div>

      {/* Brand pane — desktop only. The product's one deliberate "over-brand"
          surface, mirroring the app shell so auth reads as the same product. */}
      <div className="relative hidden overflow-hidden bg-shell lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        {/* One restrained glow, not a heavy gradient (§19) — a soft teal light from the top edge. */}
        <div
          className="pointer-events-none absolute -top-24 end-[-6rem] h-80 w-80 rounded-full bg-shell-active/20 blur-3xl"
          aria-hidden
        />

        <Link href="/" aria-label="راصد — الصفحة الرئيسية" className="relative w-fit">
          <BrandMark tone="onDark" size="lg" />
        </Link>

        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <p className="text-2xl font-bold leading-snug text-white">مركز التشغيل اليومي للمعلّم</p>
            <p className="max-w-md text-sm leading-relaxed text-shell-text-muted">
              حضور وواجبات ومتابعة وتحصيل مالي لمجموعاتك التعليمية، مجموعة في نظام واحد بدل دفاتر ومجموعات واتساب متفرقة.
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            {PILLARS.map((pillar) => (
              <li key={pillar.verb} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-shell-hover text-sm font-bold text-white">
                  {pillar.verb.charAt(0)}
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-shell-text">{pillar.verb}</span>
                  <span className="text-xs leading-relaxed text-shell-text-muted">{pillar.line}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-shell-text-muted">
          بيانات كل مساحة عمل معزولة تمامًا على مستوى قاعدة البيانات، بصلاحيات دقيقة لكل عضو فريق.
        </p>
      </div>
    </div>
  );
}
