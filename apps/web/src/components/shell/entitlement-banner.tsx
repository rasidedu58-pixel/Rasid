"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useWorkspace } from "../../lib/workspace-provider";

const BLOCKED_STATES: Record<string, string> = {
  EXPIRED: "انتهى اشتراك مساحة العمل. يمكنك مراجعة البيانات القديمة، لكن الإجراءات الجديدة معطّلة حتى التجديد.",
  PAYMENT_FAILED: "فشلت آخر عملية دفع. يمكنك مراجعة البيانات القديمة، لكن الإجراءات الجديدة معطّلة حتى تحديث وسيلة الدفع.",
};

/**
 * §25 — a persistent, unmissable banner (not just per-button disabling)
 * whenever the workspace's writes are blocked. The backend's EntitlementGuard
 * remains the real authority on every mutation; this is purely so the
 * teacher understands WHY an action is unavailable before they even try it.
 */
export function EntitlementBanner() {
  const { subscriptionState, isOwner } = useWorkspace();
  const message = subscriptionState ? BLOCKED_STATES[subscriptionState] : undefined;
  if (!message) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-warning-subtle px-4 py-2 text-sm text-warning md:px-8">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 shrink-0" aria-hidden />
        <span>{message}</span>
      </div>
      {isOwner ? (
        <Link href="/settings?tab=billing" className="shrink-0 font-medium underline">
          إدارة الاشتراك
        </Link>
      ) : null}
    </div>
  );
}
