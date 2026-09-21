import { MetricStrip, MetricCell } from "@academic-precision/ui";

export interface SummaryCell {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "warning" | "danger" | "brand";
  /**
   * Optional deep-link target for this cell. Populated ONLY when there is
   * a real filtered surface for the metric (e.g. `/attention?tab=followups`
   * for follow-ups); left undefined for metrics whose destination does
   * not exist as a supported filter — the cell then renders as a plain
   * non-interactive tile rather than a link that lies about landing you
   * somewhere useful.
   */
  href?: string;
}

/**
 * Compact "today" status strip — the disciplined alternative to a wall of KPI
 * cards. The parent passes ONLY cells it has real data for (e.g. today's
 * sessions completed/total, and live queue counts); metrics with no real
 * source (attendance %, "collected today") are intentionally never shown.
 * Renders nothing if there is nothing real to show.
 */
export function TodaySummary({ cells }: { cells: SummaryCell[] }) {
  if (cells.length === 0) return null;
  const columns = (cells.length >= 4 ? 4 : cells.length === 3 ? 3 : 2) as 2 | 3 | 4;
  return (
    <section aria-label="ملخص اليوم">
      <h2 className="mb-3 text-sm font-semibold text-text-secondary">ملخص اليوم</h2>
      <MetricStrip columns={columns}>
        {cells.map((c) => (
          <MetricCell key={c.key} label={c.label} value={c.value} sub={c.sub} tone={c.tone} href={c.href} />
        ))}
      </MetricStrip>
    </section>
  );
}
