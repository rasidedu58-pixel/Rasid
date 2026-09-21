import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@academic-precision/ui";
import { actionItemHref } from "./action-item-link";

const URGENCY_LABEL: Record<string, { label: string; tone: "danger" | "warning" | "neutral"; accent: string }> = {
  HIGH: { label: "عاجل", tone: "danger", accent: "border-s-danger" },
  MEDIUM: { label: "مهم", tone: "warning", accent: "border-s-warning" },
  LOW: { label: "للعلم", tone: "neutral", accent: "border-s-border-strong" },
};

export interface ActionItem {
  entityType: string;
  entityId: string;
  reason: string;
  urgency: "LOW" | "MEDIUM" | "HIGH";
  nextAction: string;
  /**
   * Optional single-line justification derived from a real signal on the
   * server (see `attentionCardSubtitle` in `@academic-precision/contracts`
   * + `toAttentionSection` in the API's action-center service). When
   * present it explains WHY the row exists in concrete terms (e.g.
   * "3 من آخر 5 حصص") — the teacher no longer has to open the case
   * page to understand the cause. Optional for rolling-deploy safety.
   */
  subtitle?: string;
}

/** Every row explains WHY it exists (`reason` + optional `subtitle`) and WHAT to do about it (`nextAction`) — never a bare "طالب يحتاج متابعة" without cause (§21). */
export function ActionItemRow({ item }: { item: ActionItem }) {
  const urgency = URGENCY_LABEL[item.urgency] ?? URGENCY_LABEL.LOW!;
  return (
    <Link
      href={actionItemHref(item.entityType, item.entityId)}
      className={`flex items-start gap-3 rounded-md border border-s-2 border-border ${urgency.accent} bg-surface px-4 py-3 transition-colors hover:bg-brand-subtle/30`}
    >
      <Badge tone={urgency.tone} className="mt-0.5 shrink-0">
        {urgency.label}
      </Badge>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-text-primary">{item.reason}</p>
        {item.subtitle ? (
          <p className="text-xs leading-relaxed text-text-secondary">{item.subtitle}</p>
        ) : null}
        <p className="text-xs text-text-tertiary">{item.nextAction}</p>
      </div>
      {/* ChevronLeft (‹) already points the correct "forward/detail" direction in an RTL document — no rotation needed. */}
      <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
    </Link>
  );
}
