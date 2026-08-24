import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@academic-precision/ui";
import { actionItemHref } from "./action-item-link";

const URGENCY_LABEL: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  HIGH: { label: "عاجل", tone: "danger" },
  MEDIUM: { label: "مهم", tone: "warning" },
  LOW: { label: "للعلم", tone: "neutral" },
};

export interface ActionItem {
  entityType: string;
  entityId: string;
  reason: string;
  urgency: "LOW" | "MEDIUM" | "HIGH";
  nextAction: string;
}

/** Every row explains WHY it exists (`reason`) and WHAT to do about it (`nextAction`) — never a bare "طالب يحتاج متابعة" without cause (§21). */
export function ActionItemRow({ item }: { item: ActionItem }) {
  const urgency = URGENCY_LABEL[item.urgency] ?? URGENCY_LABEL.LOW!;
  return (
    <Link href={actionItemHref(item.entityType, item.entityId)} className="flex items-start gap-3 rounded-md border border-border px-4 py-3 transition-colors hover:border-brand/40 hover:bg-brand-subtle/30">
      <Badge tone={urgency.tone} className="mt-0.5 shrink-0">
        {urgency.label}
      </Badge>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-text-primary">{item.reason}</p>
        <p className="text-xs text-text-secondary">{item.nextAction}</p>
      </div>
      {/* ChevronLeft (‹) already points the correct "forward/detail" direction in an RTL document — no rotation needed. */}
      <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
    </Link>
  );
}
