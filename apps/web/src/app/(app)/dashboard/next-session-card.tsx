"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ArrowLeft } from "lucide-react";
import { Button } from "@academic-precision/ui";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";
import { nextSessionWhen } from "./next-session-label";

export interface NextSessionInfo {
  id: string;
  groupName: string;
  scheduledAt: string;
  /**
   * OPTIONAL for rolling-deploy compatibility with a pre-durationMinutes
   * API build. When absent the client SKIPS boundary scheduling and the
   * defensive "past-end hide" — nothing invents a fallback duration; the
   * server stays the source of truth on the next refetch. See
   * `nextSessionCardSchema` in `packages/contracts/src/reports.ts` for
   * the full rollout rationale.
   */
  durationMinutes?: number;
  /**
   * DISPLAY status from the server — see `nextSessionCardSchema` in
   * `packages/contracts/src/reports.ts`. `READY` (slot arrived, not yet
   * started) is treated visually as urgent/live but with its own copy so
   * the teacher understands they still need to tap Start.
   */
  status: "SCHEDULED" | "READY" | "IN_PROGRESS";
}

/** Ticking "now" (updates every 30s) so the countdown stays live without a heavy timer. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/**
 * When the server said `IN_PROGRESS` but the local clock has crossed
 * `scheduledAt + durationMinutes`, the card no longer represents a live
 * session — hide it while a boundary-scheduled refetch is in flight, so
 * the teacher never sees a "جارية الآن" that has silently ended. The
 * server is still the source of truth on the next render.
 */
export function isStillLive(session: NextSessionInfo, now: number): boolean {
  // Rolling-deploy compat: without `durationMinutes` from the server (old
  // API build during rollout), the client CANNOT know the true end of
  // the window and must never invent one — fall through to "still live"
  // and rely on the next server refetch to correct.
  if (session.durationMinutes === undefined) return true;
  const start = new Date(session.scheduledAt).getTime();
  const end = start + session.durationMinutes * 60_000;
  if (session.status === "IN_PROGRESS" || session.status === "READY") return now < end;
  return true;
}

/**
 * The soonest boundary (start or end) still in the future; `Infinity` if
 * none, and also `Infinity` when the server did not supply
 * `durationMinutes` — the caller then skips scheduling entirely rather
 * than fabricating a boundary from a made-up duration.
 */
export function nextBoundaryMs(session: NextSessionInfo, now: number): number {
  if (session.durationMinutes === undefined) return Infinity;
  const start = new Date(session.scheduledAt).getTime();
  const end = start + session.durationMinutes * 60_000;
  const upcoming = [start, end].filter((t) => t > now);
  return upcoming.length ? Math.min(...upcoming) : Infinity;
}

/**
 * The Next Session panel — the single most time-sensitive thing on the home.
 * Built ONLY from the fields the Action Center actually returns; the
 * countdown is derived client-side from `scheduledAt` and the boundary
 * transitions (start/end) trigger a lightweight one-shot refetch of the
 * Action Center so the panel and its buckets refresh without polling
 * and without the teacher touching Refresh. No subject/roster count
 * exists on this payload, so none is shown (never invented). When there
 * is no upcoming scheduled session, a calm empty state renders instead
 * of a meaningless "0".
 */
export function NextSessionCard({ session }: { session: NextSessionInfo | null | undefined }) {
  const now = useNow();
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();

  // Owner directive (Phase 9): the state must transition WITHOUT a
  // refresh. We schedule a one-shot invalidation for the next boundary
  // (session start or end) still ahead of `now`. React Query then
  // refetches `/action-center` and the server returns the fresh
  // `nextSession` / `missedSessions` shape. No polling.
  useEffect(() => {
    if (!session || !workspaceId) return;
    const nowMs = Date.now();
    const boundary = nextBoundaryMs(session, nowMs);
    if (!Number.isFinite(boundary)) return;
    // +250 ms tolerance so the server's `now` has definitely crossed the
    // boundary by the time we ask it.
    const delay = Math.max(0, boundary - nowMs) + 250;
    const t = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: qk.actionCenter.root(workspaceId) });
    }, delay);
    return () => clearTimeout(t);
  }, [session, workspaceId, queryClient]);

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

  // Defensive fallback: if the boundary has already crossed and the
  // scheduled refetch hasn't landed yet, treat the card as no-live-session
  // rather than falsely claiming the class is ongoing. The server is still
  // the truth on the next render.
  if (!isStillLive(session, now)) {
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
            <p className="font-semibold text-text-primary">تحديث اللوحة…</p>
            <p className="mt-0.5 text-sm text-text-secondary">انتهى موعد الحصة الأخيرة وسنعرض التالية فور تحديث البيانات.</p>
          </div>
        </div>
      </section>
    );
  }

  const at = new Date(session.scheduledAt);
  const mins = Math.round((at.getTime() - now) / 60_000);
  const isInProgress = session.status === "IN_PROGRESS";
  const isReady = session.status === "READY";
  // Both live-now states (mid-class and slot-arrived-not-yet-started) get
  // full urgent styling; an upcoming session is only "imminent" within the
  // next hour.
  const imminent = isInProgress || isReady || (mins >= 0 && mins < 60);
  const eyebrow = isInProgress
    ? "الحصة الجارية الآن"
    : isReady
      ? "حان موعد الحصة"
      : "الحصة القادمة";
  // The card CTA drives the teacher to the session page — the page itself
  // routes to the correct write path (start for READY, resume for IN_PROGRESS)
  // so nothing is hard-coded to a specific mutation here.
  const cta = isInProgress ? "متابعة الحصة" : isReady ? "بدء الحصة" : "فتح الحصة";
  const when = nextSessionWhen(session.scheduledAt, session.status, now);

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
