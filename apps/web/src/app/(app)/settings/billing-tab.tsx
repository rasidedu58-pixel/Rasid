"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, ErrorState, LoadingRegion, formatDate } from "@academic-precision/ui";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";
import { fetchSubscription } from "../../../lib/api/billing";
import { SubscriptionStatusBadge } from "../../../components/billing/subscription-status-badge";
import { PaymentRequestPanel } from "../../../components/billing/payment-request-panel";
import { PlanManagementPanel } from "../../../components/billing/plan-management-panel";
import { CustomPlanPanel } from "../../../components/billing/custom-plan-panel";

/**
 * §25 — the workspace's own subscription state banner + billing entry
 * point. Never a redirect loop: checkout/portal are opened in a new tab,
 * this page keeps its own state and simply refetches when the user
 * returns.
 */
export function BillingTab() {
  const { workspaceId, isOwner } = useWorkspace();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: workspaceId ? qk.billing.subscription(workspaceId) : ["subscription", "none"],
    queryFn: () => fetchSubscription(workspaceId!),
    enabled: !!workspaceId,
  });

  if (query.isLoading) return <LoadingRegion />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const sub = query.data.subscription;

  if (!isOwner) {
    return <Card className="p-6 text-center text-sm text-text-secondary">إدارة الاشتراك متاحة لمالك مساحة العمل فقط.</Card>;
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <SubscriptionStatusBadge state={sub.state} />
          <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: qk.billing.subscription(workspaceId!) })}>
            تحديث
          </Button>
        </div>

        {sub.periodEnd ? (
          <p className="text-sm text-text-secondary">{sub.cancelAtPeriodEnd ? "سينتهي الاشتراك في" : "ينتهي/يتجدد في"} {formatDate(sub.periodEnd)}</p>
        ) : null}
      </Card>

      {/* Billing Phase 4 — current plan + usage + upgrade (immediate, prorated) + scheduled downgrade. */}
      <PlanManagementPanel workspaceId={workspaceId!} />

      {/* Billing Phase 5 — custom plan (>3000 students): request → offer → accept → pay. */}
      <CustomPlanPanel workspaceId={workspaceId!} />

      {/* Billing Phase 3 — manual payment for a NEW subscription / renewal (InstaPay / Vodafone Cash + WhatsApp proof). */}
      <PaymentRequestPanel workspaceId={workspaceId!} />
    </div>
  );
}
