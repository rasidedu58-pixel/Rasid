"use client";

import Link from "next/link";
import { Check, ArrowLeft, Rocket } from "lucide-react";
import { Button } from "@academic-precision/ui";

export interface SetupStep {
  key: string;
  label: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
}

/**
 * Onboarding "Next best action" — shown ONLY while the workspace setup is
 * incomplete (the parent hides it once every required step is done, so the
 * wizard never lingers forever). Each step's `done` is derived from REAL data
 * (does the workspace have a group / students / an operating month / a
 * session), never a stored flag, and each CTA deep-links to the exact place to
 * do it. Optional steps are separated visually and never block completion.
 */
export function OnboardingPanel({ steps, optional }: { steps: SetupStep[]; optional?: SetupStep[] }) {
  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const nextIncomplete = steps.find((s) => !s.done);

  return (
    <section
      aria-label="إعداد راصد"
      className="relative overflow-hidden rounded-2xl border border-brand/25 bg-surface p-6 shadow-sm sm:p-7"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_100%_0%,hsl(var(--brand)/0.1),transparent_70%)]" />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-cta text-brand-foreground shadow-glow">
              <Rocket className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">ابدأ مع راصد</h2>
              <p className="mt-0.5 text-sm text-text-secondary">جهّز مساحتك في خطوات قليلة لتبدأ التشغيل.</p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-brand">{pct}%</span>
        </div>

        {/* Progress */}
        <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full rounded-full bg-gradient-cta transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>

        {/* Required steps */}
        <ol className="mt-6 flex flex-col gap-2">
          {steps.map((step, i) => {
            const isNext = !step.done && step.key === nextIncomplete?.key;
            return (
              <li
                key={step.key}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  step.done ? "border-border bg-surface-sunken/50" : isNext ? "border-brand/40 bg-brand-subtle/40" : "border-border bg-surface"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    step.done ? "bg-brand text-brand-foreground" : "border border-border-strong text-text-tertiary"
                  }`}
                  aria-hidden
                >
                  {step.done ? <Check className="h-4 w-4" /> : new Intl.NumberFormat("ar-EG").format(i + 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${step.done ? "text-text-secondary" : "text-text-primary"}`}>{step.label}</p>
                  {!step.done ? <p className="mt-0.5 text-xs text-text-secondary">{step.description}</p> : null}
                </div>
                {step.done ? (
                  <span className="shrink-0 text-xs font-medium text-brand">تم</span>
                ) : (
                  <Button asChild size="sm" variant={isNext ? "primary" : "outline"} className="shrink-0">
                    <Link href={step.href} className="gap-1">
                      {step.cta}
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>

        {/* Optional steps — clearly separated, never counted toward completion */}
        {optional && optional.length > 0 ? (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">اختياري</p>
            <div className="flex flex-col gap-2">
              {optional.map((step) => (
                <div key={step.key} className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
                  <p className="text-sm text-text-secondary">{step.label}</p>
                  {step.done ? (
                    <span className="text-xs font-medium text-brand">تم</span>
                  ) : (
                    <Link href={step.href} className="text-sm font-medium text-brand hover:underline">
                      {step.cta}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
