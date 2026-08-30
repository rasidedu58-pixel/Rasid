"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, ChevronLeft, Radio, Users } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  SegmentedControl,
  SkeletonRows,
  cn,
  formatTime,
} from "@academic-precision/ui";
import type { SessionCalendarItem } from "@academic-precision/contracts";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchSessionsCalendar, fetchGroups } from "../../../lib/api/scheduling";
import { SessionQuickDrawer } from "./session-quick-drawer";
import { deriveSessionDisplay, byStart } from "./session-status";

type CalView = "day" | "week" | "month";
const WEEKDAYS_AR = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

// --- date helpers (local time — teacher's own device timezone) -------------
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Week starts on Saturday (Egypt/GCC convention). */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 1) % 7));
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

function viewRange(view: CalView, anchor: Date): { from: Date; to: Date; gridStart: Date; gridDays: number } {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1), gridStart: from, gridDays: 1 };
  }
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7), gridStart: from, gridDays: 7 };
  }
  const gridStart = startOfWeek(startOfMonth(anchor));
  return { from: gridStart, to: addDays(gridStart, 42), gridStart, gridDays: 42 };
}

function rangeLabel(view: CalView, anchor: Date): string {
  const fmtMonth = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { month: "long", year: "numeric" });
  const fmtDay = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" });
  if (view === "day") return fmtDay.format(anchor);
  if (view === "month") return fmtMonth.format(anchor);
  const s = startOfWeek(anchor);
  const e = addDays(s, 6);
  const d = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long" });
  return `${d.format(s)} – ${d.format(e)}`;
}

export default function SessionsPage() {
  const { workspaceId } = useWorkspace();
  const ws = workspaceId ?? "";

  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [selected, setSelected] = useState<SessionCalendarItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Live tick (30s) so "now" indicator, countdowns and derived statuses stay fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const { from, to, gridStart, gridDays } = useMemo(() => viewRange(view, anchor), [view, anchor]);

  const calendar = useQuery({
    queryKey: workspaceId ? qk.sessions.calendar(ws, from.toISOString(), to.toISOString()) : ["sessions", "cal", "none"],
    queryFn: () => fetchSessionsCalendar(ws, { from: from.toISOString(), to: to.toISOString() }),
    enabled: !!workspaceId,
  });

  const groupsQuery = useQuery({
    queryKey: qk.groups.list(ws),
    queryFn: () => fetchGroups(ws),
    enabled: !!workspaceId,
  });
  const groups = groupsQuery.data?.groups ?? [];

  // Now/Next — always over the next 7 days from today, independent of the viewed range.
  const todayStart = startOfDay(now);
  const nowNext = useQuery({
    queryKey: workspaceId ? qk.sessions.calendar(ws, "nownext", todayStart.toDateString()) : ["sessions", "nn", "none"],
    queryFn: () => fetchSessionsCalendar(ws, { from: todayStart.toISOString(), to: addDays(todayStart, 7).toISOString() }),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const items = useMemo(() => {
    const all = (calendar.data?.items ?? []).slice().sort(byStart);
    return groupFilter ? all.filter((s) => s.groupId === groupFilter) : all;
  }, [calendar.data, groupFilter]);

  const byDay = useMemo(() => {
    const map = new Map<string, SessionCalendarItem[]>();
    for (const it of items) {
      const k = dayKey(new Date(it.scheduledAt));
      (map.get(k) ?? map.set(k, []).get(k)!).push(it);
    }
    return map;
  }, [items]);

  const { current, next } = useMemo(() => {
    const t = now.getTime();
    const upcoming = (nowNext.data?.items ?? [])
      .filter((s) => s.status === "SCHEDULED" || s.status === "IN_PROGRESS")
      .slice()
      .sort(byStart);
    const cur = upcoming.find((s) => {
      const start = new Date(s.scheduledAt).getTime();
      const end = start + s.durationMinutes * 60_000;
      return s.status === "IN_PROGRESS" || (t >= start && t <= end);
    });
    const nxt = upcoming.find((s) => new Date(s.scheduledAt).getTime() > t);
    return { current: cur ?? null, next: nxt ?? null };
  }, [nowNext.data, now]);

  function openSession(item: SessionCalendarItem) {
    setSelected(item);
    setDrawerOpen(true);
  }
  function goToday() {
    setAnchor(startOfDay(new Date()));
  }
  function step(dir: 1 | -1) {
    setAnchor((a) => (view === "day" ? addDays(a, dir) : view === "week" ? addDays(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));
  }

  return (
    <>
      <PageHeader title="الحصص" description="مركز تشغيل الحصص — الحالية والتالية وما يحتاج استكمالًا، في مكان واحد." />

      <NowNextBanner current={current} next={next} now={now} onOpen={openSession} />

      {/* Controls */}
      <div className="mt-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => step(1)} aria-label="التالي">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>اليوم</Button>
            <Button variant="outline" size="sm" onClick={() => step(-1)} aria-label="السابق">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="ms-2 text-sm font-semibold text-text-primary">{rangeLabel(view, anchor)}</span>
          </div>
          <SegmentedControl<CalView>
            aria-label="نمط العرض"
            value={view}
            onChange={setView}
            options={[
              { value: "day", label: "يوم" },
              { value: "week", label: "أسبوع" },
              { value: "month", label: "شهر" },
            ]}
          />
        </div>

        {/* Group filter */}
        {groups.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <FilterChip active={groupFilter === null} onClick={() => setGroupFilter(null)}>الكل</FilterChip>
            {groups.map((g) => (
              <FilterChip key={g.id} active={groupFilter === g.id} onClick={() => setGroupFilter(g.id)}>{g.name}</FilterChip>
            ))}
          </div>
        ) : null}
      </div>

      {/* Body */}
      <div className="mt-4">
        {calendar.isLoading ? (
          <SkeletonRows rows={6} />
        ) : calendar.isError ? (
          <ErrorState onRetry={() => calendar.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<CalendarClock className="h-8 w-8 text-text-tertiary" aria-hidden />}
            title="لا توجد حصص في هذه الفترة"
            description="تُولَّد الحصص تلقائيًا من جدول المجموعة. جرّب فترة أخرى أو أنشئ جدولًا للمجموعة."
          />
        ) : (
          <>
            {/* Mobile: agenda-first (never a squeezed desktop calendar) */}
            <div className="md:hidden">
              <Agenda days={gridDays} gridStart={gridStart} byDay={byDay} now={now} onOpen={openSession} />
            </div>
            {/* Desktop: real calendar per selected view */}
            <div className="hidden md:block">
              {view === "month" ? (
                <MonthGrid gridStart={gridStart} anchorMonth={anchor.getMonth()} byDay={byDay} now={now} onOpen={openSession} onPickDay={(d) => { setAnchor(d); setView("day"); }} />
              ) : (
                <WeekOrDay days={gridDays} gridStart={gridStart} byDay={byDay} now={now} onOpen={openSession} />
              )}
            </div>
          </>
        )}
      </div>

      <SessionQuickDrawer item={selected} open={drawerOpen} onOpenChange={setDrawerOpen} onChanged={() => { calendar.refetch(); nowNext.refetch(); }} />
    </>
  );
}

// --- Now / Next banner ------------------------------------------------------
function NowNextBanner({ current, next, now, onOpen }: { current: SessionCalendarItem | null; next: SessionCalendarItem | null; now: Date; onOpen: (i: SessionCalendarItem) => void }) {
  if (!current && !next) return null;
  const featured = current ?? next!;
  const isCurrent = !!current;
  const start = new Date(featured.scheduledAt);
  const minsTo = Math.round((start.getTime() - now.getTime()) / 60_000);
  const countdown = !isCurrent && minsTo > 0 ? (minsTo >= 60 ? `تبدأ بعد ${arNum(Math.floor(minsTo / 60))} س ${arNum(minsTo % 60)} د` : `تبدأ بعد ${arNum(minsTo)} دقيقة`) : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(featured)}
      className={cn(
        "focus-ring mt-1 flex w-full items-center gap-4 rounded-2xl border p-4 text-start transition-colors",
        isCurrent ? "border-brand/40 bg-brand-subtle/30" : "border-border bg-surface hover:bg-surface-sunken/50",
      )}
    >
      <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", isCurrent ? "bg-brand text-brand-foreground" : "bg-brand-subtle/60 text-brand")}>
        {isCurrent ? <Radio className="h-6 w-6 animate-pulse" aria-hidden /> : <CalendarClock className="h-6 w-6" aria-hidden />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs font-semibold text-text-secondary">{isCurrent ? "الحصة الحالية" : "الحصة التالية"}</span>
        <span className="truncate text-base font-semibold text-text-primary">{featured.groupName}</span>
        <span className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="tabular-nums">{formatTime(start)}</span>
          <span>· {arNum(featured.studentCount)} طالبًا</span>
          {countdown ? <span className="text-brand">· {countdown}</span> : null}
        </span>
      </div>
      <ChevronLeft className="h-5 w-5 shrink-0 text-text-tertiary" aria-hidden />
    </button>
  );
}

// --- Session pill / card ----------------------------------------------------
function SessionCard({ item, now, onOpen, compact }: { item: SessionCalendarItem; now: Date; onOpen: (i: SessionCalendarItem) => void; compact?: boolean }) {
  const d = deriveSessionDisplay(item, now);
  const start = new Date(item.scheduledAt);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        "focus-ring group relative flex w-full items-center gap-2 overflow-hidden rounded-lg border border-border bg-surface text-start transition-all hover:border-border-strong hover:shadow-sm",
        compact ? "px-2 py-1.5" : "p-3",
      )}
    >
      <span className={cn("absolute inset-y-0 start-0 w-1", d.accentClass)} aria-hidden />
      <span className={cn("h-2 w-2 shrink-0 rounded-full", d.dotClass, d.live && "animate-pulse")} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate font-medium text-text-primary", compact ? "text-xs" : "text-sm")}>{item.groupName}</span>
        {compact ? (
          <span className="tabular-nums text-[10px] text-text-tertiary">{formatTime(start)}</span>
        ) : (
          <span className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="tabular-nums">{formatTime(start)}</span>
            <span className="inline-flex items-center gap-0.5"><Users className="h-3 w-3" aria-hidden />{arNum(item.studentCount)}</span>
          </span>
        )}
      </div>
      {!compact ? <Badge tone={d.badgeTone} className="shrink-0 text-[10px]">{d.label}</Badge> : null}
    </button>
  );
}

// --- Agenda (mobile + shared) ----------------------------------------------
function Agenda({ days, gridStart, byDay, now, onOpen }: { days: number; gridStart: Date; byDay: Map<string, SessionCalendarItem[]>; now: Date; onOpen: (i: SessionCalendarItem) => void }) {
  const dayList = Array.from({ length: days }, (_, i) => addDays(gridStart, i)).filter((d) => (byDay.get(dayKey(d))?.length ?? 0) > 0);
  return (
    <div className="flex flex-col gap-5">
      {dayList.map((d) => {
        const list = (byDay.get(dayKey(d)) ?? []).slice().sort(byStart);
        const isToday = sameDay(d, now);
        return (
          <div key={dayKey(d)} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("text-sm font-semibold", isToday ? "text-brand" : "text-text-primary")}>
                {WEEKDAYS_AR[(d.getDay() + 1) % 7]} {new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long" }).format(d)}
              </span>
              {isToday ? <Badge tone="brand" className="text-[10px]">اليوم</Badge> : null}
            </div>
            <div className="flex flex-col gap-2">
              {list.map((it) => <SessionCard key={it.id} item={it} now={now} onOpen={onOpen} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Week / Day columns (desktop) ------------------------------------------
function WeekOrDay({ days, gridStart, byDay, now, onOpen }: { days: number; gridStart: Date; byDay: Map<string, SessionCalendarItem[]>; now: Date; onOpen: (i: SessionCalendarItem) => void }) {
  const dayList = Array.from({ length: days }, (_, i) => addDays(gridStart, i));
  return (
    <div className={cn("grid gap-3", days === 1 ? "grid-cols-1" : "grid-cols-7")}>
      {dayList.map((d) => {
        const list = (byDay.get(dayKey(d)) ?? []).slice().sort(byStart);
        const isToday = sameDay(d, now);
        return (
          <div key={dayKey(d)} className={cn("flex min-h-40 flex-col gap-2 rounded-xl border p-2", isToday ? "border-brand/40 bg-brand-subtle/10" : "border-border bg-surface-sunken/30")}>
            <div className="flex items-center justify-between px-1">
              <span className={cn("text-xs font-semibold", isToday ? "text-brand" : "text-text-secondary")}>{WEEKDAYS_AR[(d.getDay() + 1) % 7]}</span>
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums", isToday ? "bg-brand text-brand-foreground" : "text-text-tertiary")}>
                {arNum(d.getDate())}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {list.length === 0 ? (
                <span className="px-1 py-4 text-center text-[11px] text-text-tertiary">—</span>
              ) : (
                list.map((it) => <SessionCard key={it.id} item={it} now={now} onOpen={onOpen} compact={days === 7} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Month grid (desktop) ---------------------------------------------------
function MonthGrid({ gridStart, anchorMonth, byDay, now, onOpen, onPickDay }: { gridStart: Date; anchorMonth: number; byDay: Map<string, SessionCalendarItem[]>; now: Date; onOpen: (i: SessionCalendarItem) => void; onPickDay: (d: Date) => void }) {
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-surface-sunken/50">
        {WEEKDAYS_AR.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-xs font-semibold text-text-secondary">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const list = (byDay.get(dayKey(d)) ?? []).slice().sort(byStart);
          const inMonth = d.getMonth() === anchorMonth;
          const isToday = sameDay(d, now);
          const shown = list.slice(0, 3);
          const overflow = list.length - shown.length;
          return (
            <div key={i} className={cn("min-h-24 border-b border-e border-border p-1.5 last:border-e-0", !inMonth && "bg-surface-sunken/40", (i + 1) % 7 === 0 && "border-e-0")}>
              <button type="button" onClick={() => onPickDay(d)} className="focus-ring mb-1 flex w-full items-center justify-between px-1">
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums", isToday ? "bg-brand text-brand-foreground" : inMonth ? "text-text-primary" : "text-text-tertiary")}>
                  {arNum(d.getDate())}
                </span>
                {list.length > 0 ? <span className="text-[10px] text-text-tertiary">{arNum(list.length)}</span> : null}
              </button>
              <div className="flex flex-col gap-1">
                {shown.map((it) => {
                  const dd = deriveSessionDisplay(it, now);
                  return (
                    <button key={it.id} type="button" onClick={() => onOpen(it)} className="focus-ring flex items-center gap-1 rounded px-1 py-0.5 text-start hover:bg-surface-sunken">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dd.dotClass, dd.live && "animate-pulse")} aria-hidden />
                      <span className="truncate text-[11px] text-text-primary">{it.groupName}</span>
                    </button>
                  );
                })}
                {overflow > 0 ? <span className="px-1 text-[10px] text-text-tertiary">+{arNum(overflow)}</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "focus-ring shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-brand bg-brand-subtle/50 text-brand-subtle-foreground" : "border-border text-text-secondary hover:bg-surface-sunken",
      )}
    >
      {children}
    </button>
  );
}
