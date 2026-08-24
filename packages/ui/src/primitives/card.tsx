import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface shadow-xs", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 border-b border-border px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-text-primary", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-xs text-text-secondary", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}

export interface SectionCardProps {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** The single "section with a heading" shape used across profile/detail pages — avoids re-deriving header layout per screen. */
export function SectionCard({ title, description, action, children, className }: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export type StatTone = "danger" | "warning" | "success" | "brand";

const STAT_TONE_CLASS: Record<StatTone, string> = {
  danger: "text-danger",
  warning: "text-warning",
  success: "text-success",
  brand: "text-brand",
};

/**
 * Phase 13 — the single small "label + big number" summary tile, replacing
 * the same handful of lines re-written ad hoc on Dashboard/Finance/Months/
 * GroupDetail/PlatformAdmin (Component Consistency Matrix finding: 5
 * near-identical local implementations). Numbers always render
 * `tabular-nums` so a grid of these never jitters as digits change.
 */
export function StatCard({ label, value, tone, className }: { label: string; value: string; tone?: StatTone; className?: string }) {
  return (
    <Card className={cn("p-4", className)}>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums text-text-primary", tone && STAT_TONE_CLASS[tone])}>{value}</p>
    </Card>
  );
}
