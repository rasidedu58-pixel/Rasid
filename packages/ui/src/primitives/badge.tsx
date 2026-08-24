import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const badgeVariants = cva("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "bg-surface-sunken text-text-secondary",
      brand: "bg-brand-subtle text-brand-subtle-foreground",
      success: "bg-success-subtle text-success",
      warning: "bg-warning-subtle text-warning",
      danger: "bg-danger-subtle text-danger",
      info: "bg-info-subtle text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export type SemanticTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

/** A small filled dot + label — for compact status indication in tables/lists where a full Badge pill is too heavy. */
export function StatusDot({ tone = "neutral", label }: { tone?: SemanticTone; label: string }) {
  const dotColor: Record<SemanticTone, string> = {
    neutral: "bg-text-tertiary",
    brand: "bg-brand",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary">
      <span className={cn("h-1.5 w-1.5 rounded-full", dotColor[tone])} aria-hidden />
      {label}
    </span>
  );
}
