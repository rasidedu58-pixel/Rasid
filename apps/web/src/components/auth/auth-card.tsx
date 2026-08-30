import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BellRing, ChartNoAxesCombined, ClipboardCheck, ShieldCheck, UsersRound } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "../brand-mark";

/**
 * The operating rhythm Rasid is built around — the same four verbs the product
 * story uses everywhere, now each carried by a real icon (never a letter chip).
 */
const FEATURES: Array<{ icon: LucideIcon; title: string; line: string }> = [
  { icon: ClipboardCheck, title: "سجّل", line: "سجّل الحضور والواجب والدرجة والملاحظات أثناء الحصة." },
  { icon: ChartNoAxesCombined, title: "افهم", line: "اعرف فورًا من يحتاج متابعة ومن يتحسن." },
  { icon: BellRing, title: "تصرّف", line: "تنبيهات واضحة للحالات التي تحتاج قرارًا أو متابعة." },
  { icon: UsersRound, title: "تابع", line: "صورة كاملة عن كل طالب ومساره واحتياجاته." },
];

/**
 * Shared visual shell for every public auth page (login / signup / verify /
 * forgot / reset). A deep-navy brand pane (the same `--shell-*` identity as the
 * authenticated app) sits next to a calm form pane. The brand pane is a real
 * product story: brand header + badge, one strong hero line, four icon-led
 * capabilities, and a quiet trust line — over a very subtle grid + glow so it
 * reads Premium, not empty. On mobile the pane collapses to the mark + name +
 * one tagline above the form. The `{title, description, children, footer}` API
 * and the auth flow are unchanged — every auth page inherits this automatically.
 */
export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
      {/* Form pane — first in DOM so it sits on the start (right) side in RTL. */}
      <div className="flex flex-col items-center justify-center bg-surface px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          {/* Brand: shown here on mobile/tablet where the brand pane is hidden. */}
          <div className="mb-8 flex flex-col items-center gap-2 lg:hidden">
            <Link href="/" aria-label="راصد — الصفحة الرئيسية">
              <BrandMark size="md" />
            </Link>
            <span className="text-xs text-text-tertiary">إدارة ومتابعة المجموعات التعليمية</span>
          </div>

          <div className="mb-6 flex flex-col gap-1.5">
            <h1 className="text-xl font-bold text-text-primary sm:text-2xl">{title}</h1>
            {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
          </div>

          {children}

          {footer ? <div className="mt-6 text-center text-sm text-text-secondary">{footer}</div> : null}
        </div>
      </div>

      {/* Brand pane — desktop only (the left side in RTL). The product's one
          deliberate "over-brand" surface, mirroring the app shell. */}
      <div className="relative hidden overflow-hidden bg-shell lg:flex lg:flex-col lg:px-12 lg:py-14">
        {/* Depth: a faint grid, a soft top-edge teal glow, and a low radial wash
            behind the hero — restrained, never a heavy gradient (§7/§12). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--shell-text)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--shell-text)) 1px, transparent 1px)",
            backgroundSize: "46px 46px",
            maskImage: "radial-gradient(120% 90% at 70% 30%, #000 40%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(120% 90% at 70% 30%, #000 40%, transparent 100%)",
          }}
        />
        <div className="pointer-events-none absolute -top-24 end-[-6rem] h-80 w-80 rounded-full bg-shell-active/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute top-1/4 end-4 h-96 w-96 rounded-full bg-shell-accent/10 blur-3xl" aria-hidden />

        {/* Top — brand header + badge */}
        <div className="relative flex flex-col items-start gap-3">
          <Link href="/" aria-label="راصد — الصفحة الرئيسية" className="w-fit">
            <BrandMark tone="onDark" size="lg" />
          </Link>
          <span className="rounded-full border border-shell-border bg-shell-hover/60 px-3 py-1 text-[11px] font-medium text-shell-text-muted">
            إدارة ومتابعة المجموعات التعليمية
          </span>
        </div>

        {/* Middle — hero + capabilities, centred and leaning slightly up */}
        <div className="relative flex flex-1 flex-col justify-center gap-9 py-10">
          <div className="flex max-w-[30rem] flex-col gap-3">
            <h2 className="text-[1.75rem] font-bold leading-[1.3] text-white">مركز التشغيل اليومي للمعلّم</h2>
            <p className="text-sm leading-relaxed text-shell-text-muted">
              تابع حضور الطلاب، الواجبات، التحصيل، المدفوعات والتواصل مع أولياء الأمور من مكان واحد.
            </p>
          </div>

          <ul className="flex max-w-[32rem] flex-col gap-5">
            {FEATURES.map(({ icon: Icon, title: featTitle, line }) => (
              <li key={featTitle} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-shell-border bg-shell-hover text-shell-accent">
                  <Icon className="h-[19px] w-[19px]" aria-hidden />
                </span>
                <div className="flex flex-col gap-0.5 pt-0.5">
                  <span className="text-sm font-semibold text-shell-text">{featTitle}</span>
                  <span className="text-xs leading-relaxed text-shell-text-muted">{line}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom — trust line */}
        <div className="relative flex items-center gap-2.5 text-xs text-shell-text-muted">
          <ShieldCheck className="h-4 w-4 shrink-0 text-shell-accent/80" aria-hidden />
          <span>بيانات كل مساحة عمل معزولة، مع صلاحيات دقيقة لكل عضو في الفريق.</span>
        </div>
      </div>
    </div>
  );
}
