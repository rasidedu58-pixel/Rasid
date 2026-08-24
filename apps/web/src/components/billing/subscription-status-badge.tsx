import { Badge, type SemanticTone } from "@academic-precision/ui";

/**
 * State → label/tone mapping (§25): CANCELLED_AT_PERIOD_END remains active
 * until its effective end, so it is deliberately shown as "info" (a
 * heads-up), not "danger" (a block) — the workspace is still fully
 * writable until the period actually ends.
 */
const STATE_MAP: Record<string, { label: string; tone: SemanticTone }> = {
  TRIAL: { label: "فترة تجريبية", tone: "brand" },
  ACTIVE: { label: "الاشتراك نشط", tone: "success" },
  EXPIRING: { label: "الاشتراك ينتهي قريبًا", tone: "warning" },
  CANCELLED_AT_PERIOD_END: { label: "سيُلغى في نهاية الفترة", tone: "info" },
  EXPIRED: { label: "انتهى الاشتراك", tone: "danger" },
  PAYMENT_FAILED: { label: "فشلت عملية الدفع", tone: "danger" },
};

export function SubscriptionStatusBadge({ state, className }: { state: string; className?: string }) {
  const entry = STATE_MAP[state] ?? { label: state, tone: "neutral" as const };
  return (
    <Badge tone={entry.tone} className={className}>
      {entry.label}
    </Badge>
  );
}
