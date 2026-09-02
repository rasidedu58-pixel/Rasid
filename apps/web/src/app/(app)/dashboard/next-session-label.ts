import { formatDateTime } from "@academic-precision/ui";

const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The human "when" line for the Next/Current Session panel. Pure so the
 * today/tomorrow/live/countdown boundaries can be regression-tested without a
 * DOM. All comparisons are in the viewer's LOCAL day (Egypt in production):
 * times are stored/transported as UTC ISO and only rendered locally here, so a
 * session at 23:50 today never leaks into "tomorrow" for the local reader.
 */
export function nextSessionWhen(scheduledAt: string, status: "SCHEDULED" | "IN_PROGRESS", nowMs: number): string {
  if (status === "IN_PROGRESS") return "جارية الآن — سجّل الحضور والواجب";
  const at = new Date(scheduledAt);
  const mins = Math.round((at.getTime() - nowMs) / 60_000);
  if (mins <= 0) return "بدأ موعدها للتو";
  if (mins < 60) return `تبدأ بعد ${arNum(mins)} دقيقة`;
  const timeStr = new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit" }).format(at);
  const now = new Date(nowMs);
  if (sameLocalDay(at, now)) return `اليوم • ${timeStr}`;
  const tomorrow = new Date(nowMs);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameLocalDay(at, tomorrow)) return `غدًا • ${timeStr}`;
  return formatDateTime(scheduledAt);
}
