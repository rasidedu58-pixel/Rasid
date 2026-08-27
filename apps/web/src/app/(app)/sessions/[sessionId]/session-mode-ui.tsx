"use client";

import type { ReactNode } from "react";
import { cn } from "@academic-precision/ui";

/**
 * Shared Session-Mode presentation (Phase UI-3). The three recording tabs
 * (attendance / homework / exam) share ONE interaction grammar — a connected
 * segmented status control on a dense, indexed roster row — so a teacher
 * scans 30 students the same way everywhere. Purely presentational; each tab
 * keeps its own save/mutation logic unchanged.
 */

type StatusTone = "success" | "warning" | "danger" | "neutral" | "brand";

const ACTIVE_TEXT: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-text-primary",
  brand: "text-brand",
};

export interface StatusOption<T extends string> {
  value: T;
  label: string;
  tone: StatusTone;
}

/**
 * A connected segmented control for a single roster field. The whole control
 * sits in a subtle sunken track; the selected segment lifts onto the surface
 * and takes its semantic tone as text colour (not a loud filled block). Fully
 * keyboard-accessible; touch-friendly hit targets.
 */
export function SegmentedStatus<T extends string>({
  options,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  options: ReadonlyArray<StatusOption<T>>;
  value: T | null | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "min-w-[52px] rounded-[6px] px-2.5 py-1.5 text-[13px] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:opacity-40",
              active ? cn("bg-surface shadow-xs", ACTIVE_TEXT[opt.tone]) : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** A thin progress bar + "X من Y" readout for the roster's recorded count. Sticky-friendly. */
export function RosterProgress({ recorded, total, unit = "مُسجّل" }: { recorded: number; total: number; unit?: string }) {
  const pct = total > 0 ? Math.round((recorded / total) * 100) : 0;
  const done = recorded >= total && total > 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className={cn("font-medium tabular-nums", done ? "text-success" : "text-text-secondary")}>
          {recorded} من {total} {unit}
        </span>
        <span className="text-xs text-text-tertiary tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
        <div className={cn("h-full rounded-full transition-[width] duration-300", done ? "bg-success" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The bordered container for a roster; rows divide inside it. */
export function RosterList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">{children}</div>;
}

/** One dense roster row: a muted index, the student name, and the field control on the end (content-facing) side. Subtle hover; a faint tint while its own save is in flight. */
export function RosterRow({ index, name, saving, children }: { index: number; name: string; saving?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-3 py-2.5 transition-colors sm:px-4", saving ? "bg-brand-subtle/30" : "hover:bg-surface-sunken/40")}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="w-5 shrink-0 text-end text-xs text-text-tertiary tabular-nums">{index}</span>
        <span className="truncate text-sm font-medium text-text-primary">{name}</span>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
