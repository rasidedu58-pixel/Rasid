/**
 * Presentation-only formatting helpers — Phase 11.
 *
 * These NEVER compute a financial total, remaining balance, or any other
 * business figure themselves; they only format a number the API already
 * computed (minor units -> a localized currency string, an ISO date ->
 * an Arabic label). All arithmetic (sums, remaining, overdue, proration...)
 * stays server-side — see `docs/02_TECHNICAL_ARCHITECTURE...` and the
 * Phase 11 architecture rules (§4.14/§22).
 */

/**
 * `-u-nu-latn`: Western/Hindu-Arabic digits (1, 2, 3...), not Arabic-Indic
 * (١, ٢, ٣...) — plain `ar-EG` renders Arabic-Indic digits by default, but
 * modern Egyptian software (banking apps, e-commerce, SaaS) overwhelmingly
 * uses Western digits even in a fully Arabic UI; this matches that real
 * convention and this product's "modern operational SaaS, not a classic
 * government form" design direction. Month/weekday NAMES stay Arabic —
 * only the digit glyphs change.
 */
const EGP_LOCALE = "ar-EG-u-nu-latn";

/**
 * `amountMinor` is an integer count of the smallest currency unit (piastres
 * for EGP) — exactly what every finance/billing endpoint returns. Division
 * by 100 here is a DISPLAY conversion only (the same thing `Intl.NumberFormat`
 * would need as a plain JS number argument); no rounding/summing of
 * multiple values ever happens in this function.
 */
export function formatMoney(amountMinor: number, currencyCode = "EGP"): string {
  const major = amountMinor / 100;
  return new Intl.NumberFormat(EGP_LOCALE, {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: "symbol",
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(EGP_LOCALE).format(value);
}

const monthFormatter = new Intl.DateTimeFormat(EGP_LOCALE, { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat(EGP_LOCALE, { day: "numeric", month: "long", year: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat(EGP_LOCALE, { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat(EGP_LOCALE, { hour: "numeric", minute: "2-digit" });
const weekdayFormatter = new Intl.DateTimeFormat(EGP_LOCALE, { weekday: "long" });

export function formatMonthLabel(year: number, month: number): string {
  return monthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
}

export function formatDate(iso: string | Date): string {
  return dateFormatter.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatDateTime(iso: string | Date): string {
  return dateTimeFormatter.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatTime(iso: string | Date): string {
  return timeFormatter.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatWeekday(iso: string | Date): string {
  return weekdayFormatter.format(typeof iso === "string" ? new Date(iso) : iso);
}

/** Relative-ish "منذ ٣ أيام"/"خلال ٣ أيام" phrasing for notification/attention timestamps. */
export function formatRelativeToNow(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const rtf = new Intl.RelativeTimeFormat(EGP_LOCALE, { numeric: "auto" });

  const abs = Math.abs(diffMinutes);
  if (abs < 60) return rtf.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return rtf.format(diffDays, "day");
  const diffMonths = Math.round(diffDays / 30);
  return rtf.format(diffMonths, "month");
}
