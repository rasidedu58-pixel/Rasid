"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, ErrorState, LoadingRegion, formatDate, toast } from "@academic-precision/ui";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";
import { fetchSubscription, createCheckout, createPortalSession } from "../../../lib/api/billing";
import { SubscriptionStatusBadge } from "../../../components/billing/subscription-status-badge";

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

  const checkoutMutation = useMutation({
    mutationFn: () => createCheckout(workspaceId!, { returnUrl: `${window.location.origin}/settings?tab=billing` }),
    onSuccess: (res) => window.open(res.checkoutUrl, "_blank"),
    onError: () => toast.error("تعذّر فتح صفحة الدفع"),
  });
  const portalMutation = useMutation({
    mutationFn: () => createPortalSession(workspaceId!, { returnUrl: `${window.location.origin}/settings?tab=billing` }),
    onSuccess: (res) => window.open(res.portalUrl, "_blank"),
    onError: () => toast.error("تعذّر فتح بوابة إدارة الاشتراك"),
  });

  if (query.isLoading) return <LoadingRegion />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const sub = query.data.subscription;
  const needsCheckout = sub.state === "EXPIRED" || sub.state === "PAYMENT_FAILED";

  if (!isOwner) {
    return <Card className="p-6 text-center text-sm text-text-secondary">إدارة الاشتراك متاحة لمالك مساحة العمل فقط.</Card>;
  }

  return (
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

      {needsCheckout ? (
        <Button onClick={() => checkoutMutation.mutate()} loading={checkoutMutation.isPending} className="self-start">
          تجديد الاشتراك
        </Button>
      ) : (
        <Button variant="outline" onClick={() => portalMutation.mutate()} loading={portalMutation.isPending} className="self-start">
          إدارة الاشتراك والفواتير
        </Button>
      )}
    </Card>
  );
}
