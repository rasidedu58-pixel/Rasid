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
    <div role="radiogroup" aria-label={ariaLabel} className="flex w-full flex-wrap items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5 sm:inline-flex sm:w-auto sm:flex-nowrap">
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
              "min-w-0 flex-1 basis-20 whitespace-nowrap rounded-[6px] px-2 py-1.5 text-[13px] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 sm:flex-initial sm:basis-auto sm:min-w-[52px] sm:px-2.5",
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

/**
 * One dense roster row: a muted index, the student name, and the field
 * control. Shared by the attendance, homework and exam tabs, so the fix
 * lands in one place for all three.
 *
 * It used to be a single line at every width with a non-shrinking control
 * on the end — and homework's four-state control needs ~290px on its own,
 * which left the name clipped to a few characters on a phone and squeezed
 * at tablet width. Now it stacks below `sm` (name on its own line, control
 * underneath, name shown in FULL and allowed to wrap) and returns to the
 * original single line from `sm` up, where there is room for both.
 */
export function RosterRow({ index, name, saving, children }: { index: number; name: string; saving?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col items-stretch gap-2 px-3 py-2.5 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4", saving ? "bg-brand-subtle/30" : "hover:bg-surface-sunken/40")}>
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <span className="w-5 shrink-0 text-end text-xs leading-5 text-text-tertiary tabular-nums">{index}</span>
        <span className="min-w-0 break-words text-sm font-medium leading-5 text-text-primary sm:truncate">{name}</span>
      </div>
      <div className="min-w-0 sm:shrink-0">{children}</div>
    </div>
  );
}
