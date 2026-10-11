"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import {
  EmptyState,
  ErrorState,
  PermissionDeniedState,
  SkeletonRows,
  cn,
  formatRelativeToNow,
} from "@academic-precision/ui";
import { hasPlatformPermission } from "@academic-precision/contracts";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchPlatformNotifications, markPlatformNotificationRead } from "../../../lib/api/platform-admin";
import { platformNotificationHref } from "../../../lib/platform-notification-link";
import { isForbidden } from "../../../lib/api/client";

const TYPE_LABEL: Record<string, string> = {
  NEW_PAYMENT_PROOF_PENDING: "طلب دفع يحتاج مراجعة",
  CUSTOM_REQUEST_CREATED: "طلب باقة مخصّصة",
};

/**
 * Staff inbox for the platform-facing notifications only (migration 0077's RLS
 * policy makes a customer's own notifications unreachable on this connection).
 * Each row links to the screen where the thing is actually resolved — never to
 * a dashboard.
 */
export default function PlatformAdminNotificationsPage() {
  const { platformRole } = useWorkspace();
  const queryClient = useQueryClient();
  const canView = hasPlatformPermission(platformRole, "platform.billing.view");

  const query = useQuery({
    queryKey: qk.platformAdmin.notifications(),
    queryFn: fetchPlatformNotifications,
    enabled: canView,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => markPlatformNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.platformAdmin.notifications() }),
  });

  if (!canView || isForbidden(query.error)) return <PermissionDeniedState />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="الإشعارات" description="ما يحتاج مراجعة من فريق راصد — طلبات الدفع والباقات المخصّصة." />

      {query.isLoading ? (
        <SkeletonRows rows={5} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.notifications.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد إشعارات" />
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {query.data!.notifications.map((n) => {
            const unread = !n.readAt;
            return (
              <div key={n.id} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken/30">
                <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden>
                  {unread ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className={cn("text-sm", unread ? "font-semibold text-text-primary" : "font-medium text-text-secondary")}>
                      {n.title}
                      {unread ? <span className="sr-only"> (غير مقروء)</span> : null}
                    </p>
                    <span className="shrink-0 text-xs text-text-tertiary">{formatRelativeToNow(n.createdAt)}</span>
                  </div>
                  <p className="break-words text-sm text-text-secondary">{n.body}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-text-tertiary">{TYPE_LABEL[n.type] ?? n.type}</span>
                    <Link
                      href={platformNotificationHref(n.entityType)}
                      className="font-medium text-brand hover:text-brand/80"
                      onClick={() => unread && markRead.mutate(n.id)}
                    >
                      مراجعة الطلب
                    </Link>
                    {unread ? (
                      <button
                        type="button"
                        onClick={() => markRead.mutate(n.id)}
                        className="focus-ring rounded-sm text-text-tertiary transition-colors hover:text-text-secondary"
                      >
                        تعليم كمقروء
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
