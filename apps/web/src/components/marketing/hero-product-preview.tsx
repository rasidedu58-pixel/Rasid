"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarRange, ClipboardCheck, FileBarChart, Layers, Sparkles, Users, Wallet } from "lucide-react";
import { Badge, Card, CardContent } from "@academic-precision/ui";
import { RasidMark } from "../brand/rasid-mark";
import { TiltCard } from "./anim";

const ROWS = [
  { label: "٣ طلاب لم يُسجَّل حضورهم أمس", tone: "warning" as const, badge: "متوسط" },
  { label: "دفعة متأخرة من ولي أمر — تذكير مطلوب", tone: "danger" as const, badge: "عاجل" },
  { label: "متابعة مستحقة لحالة انتباه مفتوحة", tone: "neutral" as const, badge: "سياقي" },
];
const STATS = [
  { icon: Users, label: "الطلاب" },
  { icon: Wallet, label: "المالية" },
  { icon: FileBarChart, label: "التقارير" },
];

// Focus sequence: row0 → row1 → row2 → finance stat → rest. ~9s loop.
const SEQUENCE = [0, 1, 2, 3, null] as const;
const STEP_MS = 1900;

/**
 * Honest product mockup — built from the SAME tokens/labels the real Dashboard
 * uses — made subtly ALIVE: a focus quietly travels across the "يحتاج إجراء"
 * rows, lands on the finance tile, then rests, on a slow loop (illustrative
 * only, invents no feature). Static under reduced motion; rows also respond to
 * a real hover on desktop. The loop only runs while the frame is on screen.
 */
export function HeroProductPreview() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let i = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      setFocus(SEQUENCE[i % SEQUENCE.length] ?? null);
      i += 1;
    };
    const start = () => {
      if (timer) return;
      tick();
      timer = setInterval(tick, STEP_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    // Only animate while visible (saves work + avoids a background timer).
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? start() : stop())), { threshold: 0.35 })
        : null;
    if (io) io.observe(el);
    else start();
    return () => {
      stop();
      io?.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className="relative mx-auto max-w-md lg:max-w-none">
      <div aria-hidden className="pointer-events-none absolute -inset-6 -z-10 bg-[radial-gradient(60%_60%_at_50%_30%,hsl(var(--brand)/0.18),transparent_70%)]" />

      <div className="rasid-float pointer-events-none absolute -start-4 top-14 z-10 hidden rounded-xl border border-border bg-surface px-3 py-2 shadow-floating sm:block" style={{ animationDelay: "0.4s" }}>
        <p className="flex items-center gap-2 text-xs font-medium text-text-primary">
          <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden />
          حضور حصة اليوم سُجّل
        </p>
      </div>
      <div className="rasid-float pointer-events-none absolute -end-3 bottom-16 z-10 hidden rounded-xl border border-border bg-surface px-3 py-2 shadow-floating sm:block" style={{ animationDelay: "1.4s" }}>
        <p className="flex items-center gap-2 text-xs font-medium text-text-primary">
          <Wallet className="h-4 w-4 text-danger" aria-hidden />
          دفعة متأخرة — تذكير
        </p>
      </div>

      <TiltCard>
        <Card className="overflow-hidden rounded-2xl border-border/80 shadow-floating">
          <div className="flex">
            <div className="hidden w-14 shrink-0 flex-col items-center gap-3 bg-shell py-4 sm:flex">
              <RasidMark size={24} />
              <span className="h-8 w-8 rounded-md bg-shell-active" />
              {[Users, Layers, CalendarRange, Wallet].map((Icon, i) => (
                <Icon key={i} className="h-4 w-4 text-shell-text-muted" aria-hidden />
              ))}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between border-b border-border bg-surface-sunken px-4 py-3">
                <span className="text-xs font-medium text-text-secondary">الرئيسية</span>
                <span className="flex items-center gap-1 text-[11px] text-text-tertiary">
                  <Sparkles className="h-3 w-3 text-brand" aria-hidden />
                  مركز الإجراءات
                </span>
              </div>
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-center justify-between rounded-lg border border-brand/25 bg-brand-subtle px-3 py-2.5 text-sm">
                  <span className="text-brand-subtle-foreground">الحصة القادمة: مجموعة الرياضيات</span>
                  <span className="rounded-md bg-gradient-cta px-2 py-1 text-xs font-medium text-brand-foreground">فتح الحصة</span>
                </div>
                <p className="pt-1 text-xs font-semibold text-text-secondary">يحتاج إجراء الآن</p>
                {ROWS.map((row, i) => (
                  <div
                    key={row.label}
                    className="group/row flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-brand/40"
                    style={
                      focus === i
                        ? { borderColor: "hsl(var(--brand) / 0.5)", background: "hsl(var(--brand) / 0.08)", boxShadow: "0 0 0 3px hsl(var(--brand) / 0.12)" }
                        : { borderColor: "hsl(var(--border))" }
                    }
                  >
                    <span className="text-text-primary">{row.label}</span>
                    <Badge tone={row.tone}>{row.badge}</Badge>
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {STATS.map((s, i) => {
                    const Icon = s.icon;
                    const lit = focus === 3 && i === 1; // finance tile is the resolution beat
                    return (
                      <div
                        key={s.label}
                        className="flex flex-col items-center gap-1 rounded-lg border py-3 text-xs text-text-secondary transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                        style={lit ? { borderColor: "hsl(var(--brand) / 0.5)", boxShadow: "0 0 0 3px hsl(var(--brand) / 0.12)" } : { borderColor: "hsl(var(--border))" }}
                      >
                        <Icon className="h-4 w-4 text-brand" aria-hidden />
                        {s.label}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </div>
          </div>
        </Card>
      </TiltCard>
    </div>
  );
}
