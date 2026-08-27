import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * A slim operational status strip (Phase UI-2) — the disciplined alternative
 * to a row of giant KPI cards. One bordered surface divided into equal cells
 * by hairline dividers (Stripe-style), each a quiet label over a strong
 * value. Wraps to two columns on narrow widths. Never invents data — the
 * caller passes only values it already has.
 */
export function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0 sm:divide-x-reverse",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One cell of a MetricStrip: a muted label, a strong value (tabular for
 * numbers), and an optional sub-line. `tone` tints only the value — reserved
 * for a genuinely semantic reading (e.g. an outstanding balance in danger),
 * never decoration.
 */
export function MetricCell({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "brand";
  icon?: ReactNode;
}) {
  const valueTone: Record<NonNullable<typeof tone>, string> = {
    default: "text-text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    brand: "text-brand",
  };
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-text-tertiary">
        {icon}
        {label}
      </span>
      <span className={cn("text-lg font-semibold leading-none tabular-nums", valueTone[tone])}>{value}</span>
      {sub ? <span className="text-xs text-text-secondary">{sub}</span> : null}
    </div>
  );
}
