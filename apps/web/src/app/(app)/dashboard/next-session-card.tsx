"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ArrowLeft } from "lucide-react";
import { Button, formatDateTime } from "@academic-precision/ui";

export interface NextSessionInfo {
  id: string;
  groupName: string;
  scheduledAt: string;
  status: "SCHEDULED" | "IN_PROGRESS";
}

const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

/** Ticking "now" (updates every 30s) so the countdown stays live without a heavy timer. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The Next Session panel — the single most time-sensitive thing on the home.
 * Built ONLY from the fields the Action Center actually returns
 * (`{id, groupName, scheduledAt}`); the countdown is derived client-side from
 * `scheduledAt`. No subject/roster count exists on this payload, so none is
 * shown (never invented). When there is no upcoming scheduled session, a calm
 * empty state renders instead of a meaningless "0".
 */
export function NextSessionCard({ session }: { session: NextSessionInfo | null | undefined }) {
  const now = useNow();

  if (!session) {
    return (
      <section
        aria-label="الحصة القادمة"
        className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-sunken text-text-tertiary">
            <CalendarClock className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold text-text-primary">لا توجد حصص قادمة مجدولة</p>
            <p className="mt-0.5 text-sm text-text-secondary">سنعرض هنا حصتك التالية فور جدولتها.</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/sessions">عرض الحصص</Link>
        </Button>
      </section>
    );
  }

  const at = new Date(session.scheduledAt);
  const mins = Math.round((at.getTime() - now) / 60_000);
  const isLive = session.status === "IN_PROGRESS";
  // A live session is always the most urgent thing on the page (highlight it);
  // an upcoming one is only "imminent" within the next hour.
  const imminent = isLive || (mins >= 0 && mins < 60);
  const eyebrow = isLive ? "الحصة الجارية الآن" : "الحصة القادمة";
  const cta = isLive ? "متابعة الحصة" : "فتح الحصة";

  let when: string;
  if (isLive) when = "جارية الآن — سجّل الحضور والواجب";
  else if (mins <= 0) when = "بدأ موعدها للتو";
  else if (mins < 60) when = `تبدأ بعد ${arNum(mins)} دقيقة`;
  else if (sameLocalDay(at, new Date(now))) when = `اليوم • ${new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit" }).format(at)}`;
  else when = formatDateTime(session.scheduledAt);

  return (
    <section
      aria-label={eyebrow}
      className={`relative overflow-hidden rounded-2xl border p-6 shadow-sm transition-shadow ${
        imminent ? "border-brand/40 bg-surface shadow-glow" : "border-border bg-surface"
      }`}
    >
      {imminent ? <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_0%,hsl(var(--brand)/0.1),transparent_70%)]" /> : null}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-cta text-brand-foreground shadow-glow">
            <CalendarClock className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-brand">{eyebrow}</p>
            <p className="mt-0.5 truncate text-lg font-semibold text-text-primary">{session.groupName}</p>
            <p className={`mt-0.5 text-sm ${imminent ? "font-medium text-brand" : "text-text-secondary"}`}>{when}</p>
          </div>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href={`/sessions/${session.id}`} className="gap-1.5">
            {cta}
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}
