import type { SessionCalendarItem, SessionStatus } from "@academic-precision/contracts";

/**
 * Display-only session lifecycle for the operations calendar. This is DERIVED
 * on the client from the real stored `status` + the session's time window — it
 * never changes any business rule or backend state. It refines the 5 stored
 * statuses (SCHEDULED / IN_PROGRESS / COMPLETED / CANCELLED / RESCHEDULED) into
 * the operations-facing lifecycle the teacher reads at a glance:
 *
 *   قادمة · تبدأ قريبًا · جاهزة للتسجيل · جارية · تحتاج استكمال · مكتملة · ملغاة · مؤجّلة
 *
 * The key case: a SCHEDULED session whose window has PASSED but was never
 * started/completed is "تحتاج استكمال" (needs completion) — never silently
 * treated as done (per the product spec). A running session's own record gaps
 * are surfaced separately in the quick drawer via `GET /sessions/:id/review`.
 */
export type SessionDisplayKey =
  | "upcoming"
  | "soon"
  | "ready"
  | "in_progress"
  | "needs_completion"
  | "completed"
  | "cancelled"
  | "rescheduled";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export interface SessionDisplay {
  key: SessionDisplayKey;
  label: string;
  badgeTone: BadgeTone;
  /** Tailwind bg class for the calendar pill's leading dot. */
  dotClass: string;
  /** Tailwind classes for a session card's start-edge accent. */
  accentClass: string;
  /** True for states that visually pulse (live / needs action now). */
  live: boolean;
}

/** Minutes-before-start under which an upcoming session reads as "تبدأ قريبًا". */
export const SOON_THRESHOLD_MIN = 30;

export function sessionEnd(item: { scheduledAt: string; durationMinutes: number }): Date {
  return new Date(new Date(item.scheduledAt).getTime() + item.durationMinutes * 60_000);
}

export function deriveSessionDisplay(
  item: { status: SessionStatus; scheduledAt: string; durationMinutes: number },
  now: Date = new Date(),
): SessionDisplay {
  const start = new Date(item.scheduledAt);
  const end = sessionEnd(item);
  const t = now.getTime();

  switch (item.status) {
    case "COMPLETED":
      return { key: "completed", label: "مكتملة", badgeTone: "success", dotClass: "bg-success", accentClass: "bg-success/60", live: false };
    case "CANCELLED":
      return { key: "cancelled", label: "ملغاة", badgeTone: "neutral", dotClass: "bg-text-tertiary", accentClass: "bg-border-strong", live: false };
    case "RESCHEDULED":
      return { key: "rescheduled", label: "مؤجّلة", badgeTone: "warning", dotClass: "bg-warning", accentClass: "bg-warning/50", live: false };
    case "IN_PROGRESS":
      return { key: "in_progress", label: "جارية", badgeTone: "brand", dotClass: "bg-brand", accentClass: "bg-brand", live: true };
    case "SCHEDULED":
    default:
      break;
  }

  // SCHEDULED — refine by the time window.
  if (t < start.getTime()) {
    const minsToStart = (start.getTime() - t) / 60_000;
    if (minsToStart <= SOON_THRESHOLD_MIN) {
      return { key: "soon", label: "تبدأ قريبًا", badgeTone: "brand", dotClass: "bg-brand", accentClass: "bg-brand", live: true };
    }
    return { key: "upcoming", label: "قادمة", badgeTone: "neutral", dotClass: "bg-text-tertiary", accentClass: "bg-border-strong", live: false };
  }
  if (t <= end.getTime()) {
    // Window is active but the session was never started → ready to record now.
    return { key: "ready", label: "جاهزة للتسجيل", badgeTone: "brand", dotClass: "bg-brand", accentClass: "bg-brand", live: true };
  }
  // Window passed, never started/completed → needs completion.
  return { key: "needs_completion", label: "تحتاج استكمال", badgeTone: "warning", dotClass: "bg-warning", accentClass: "bg-warning", live: false };
}

/** The primary drawer action label for a session's current display state. */
export function primaryActionLabel(key: SessionDisplayKey): string {
  switch (key) {
    case "in_progress":
      return "العودة للحصة";
    case "ready":
    case "soon":
    case "upcoming":
      return "بدء الحصة";
    case "needs_completion":
      return "استكمال التسجيل";
    default:
      return "فتح الحصة كاملة";
  }
}

/** Sorts calendar items by start time then id (stable). */
export function byStart(a: SessionCalendarItem, b: SessionCalendarItem): number {
  return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || a.id.localeCompare(b.id);
}
