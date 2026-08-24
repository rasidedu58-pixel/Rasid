import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Plain, dependency-free table primitives (no headless table library — V1
 * lists are backend-paginated/filtered already, no client-side sort/virtualize
 * complexity to justify one). Wrap in `TableScroll` for mobile so wide
 * tables scroll horizontally INSIDE their own container instead of
 * breaking the page layout (§33 requirement).
 */
export function TableScroll({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("w-full overflow-x-auto rounded-lg border border-border", className)}>{children}</div>;
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full min-w-max caption-bottom text-sm", className)} {...props} />;
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-sunken", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-surface-sunken/60", className)} {...props} />;
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-10 px-4 text-start align-middle text-xs font-medium text-text-secondary", className)} {...props} />;
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3 align-middle text-text-primary", className)} {...props} />;
}
