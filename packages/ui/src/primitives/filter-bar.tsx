"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Rasid filter grammar (Phase UI-1) — one reusable vocabulary for
 * search + quick filters + active-filter chips, so every operational list
 * (students, groups, sessions, finance, attention, reports) filters the
 * same way instead of each page inventing its own search box. Purely
 * presentational: the caller owns state and only ever passes filters that
 * the underlying API actually supports — no client-side faking of
 * server-paginated data.
 */

/** The bar that holds a page's search + quick filters + trailing actions. Lays them out with consistent rhythm and wraps cleanly on narrow widths. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

/** A search field with a leading icon, sized to sit inline in a FilterBar. Grows to fill available space up to a comfortable reading width. */
export interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(({ className, containerClassName, ...props }, ref) => {
  return (
    <div className={cn("relative min-w-0 flex-1 basis-64 sm:max-w-xs", containerClassName)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
      <input
        ref={ref}
        type="search"
        className={cn(
          "h-9 w-full rounded-md border border-border-strong bg-surface ps-9 pe-3 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus-ring",
          className,
        )}
        {...props}
      />
    </div>
  );
});
SearchInput.displayName = "SearchInput";

/**
 * A compact segmented control — the premium alternative to a row of loose
 * toggle buttons, for mutually-exclusive quick filters (e.g. search-by
 * mode, an API-backed status filter, a view switch). The whole control sits
 * in a subtle sunken track; the active segment lifts onto the surface.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  className,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  "aria-label"?: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn("inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-sunken p-0.5", className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]",
              active ? "bg-surface text-text-primary shadow-xs" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** A single active-filter chip with a remove affordance — shown below the FilterBar when filters are applied, so what's narrowing the list is always visible and one click from cleared. */
export function FilterChip({ label, onRemove }: { label: ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-text-secondary">
      {label}
      {onRemove ? (
        <button type="button" onClick={onRemove} className="rounded-sm text-text-tertiary transition-colors hover:text-text-primary focus-ring" aria-label="إزالة الفلتر">
          <X className="h-3 w-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

/** The active-chips row: renders the applied filters + a persistent "مسح الفلاتر" when any are active. Renders nothing when there are no active filters. */
export function ActiveFilters({ chips, onClearAll, className }: { chips: ReactNode; onClearAll?: () => void; className?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2", className)}>
      {chips}
      {onClearAll ? (
        <button type="button" onClick={onClearAll} className="rounded-sm text-xs font-medium text-brand transition-colors hover:text-brand/80 focus-ring">
          مسح الفلاتر
        </button>
      ) : null}
    </div>
  );
}
