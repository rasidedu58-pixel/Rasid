"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button, EmptyState, ErrorState, SkeletonRows, cn, formatRelativeToNow, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "../../../lib/api/reports";
import { actionItemHref } from "../dashboard/action-item-link";

const TYPE_LABEL: Record<string, string> = {
  SUBSCRIPTION_EXPIRING: "اقتراب انتهاء الاشتراك",
  FOLLOWUP_DUE: "متابعة مستحقة",
  MISSING_RECORDS: "سجلات ناقصة",
};

export default function NotificationsPage() {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: workspaceId ? qk.notifications.list(workspaceId) : ["notifications", "none"],
    queryFn: () => fetchNotifications(workspaceId!),
    enabled: !!workspaceId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.notifications.list(workspaceId!) });
  const markReadMutation = useMutation({ mutationFn: (id: string) => markNotificationRead(workspaceId!, id), onSuccess: invalidate });
  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(workspaceId!),
    onSuccess: () => { invalidate(); toast.success("تم تعليم الكل كمقروء"); },
  });

  return (
    <>
      <PageHeader
        title="الإشعارات"
        actions={
          query.data && query.data.unreadCount > 0 ? (
            <Button size="sm" variant="outline" onClick={() => markAllReadMutation.mutate()} loading={markAllReadMutation.isPending}>
              تعليم الكل كمقروء
            </Button>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <SkeletonRows rows={5} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.notifications.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد إشعارات" />
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {query.data!.notifications.map((n) => {
            const href = actionItemHref(n.entityType ?? "", n.entityId ?? "");
            const unread = !n.readAt;
            return (
              <div key={n.id} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken/30">
                {/* Subtle unread marker — a small brand dot, not a bright background block. */}
                <span className="mt-1.5 flex w-2 shrink-0 justify-center" aria-hidden>
                  {unread ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className={cn("text-sm", unread ? "font-semibold text-text-primary" : "font-medium text-text-secondary")}>
                      {n.title}
                      {unread ? <span className="sr-only"> (غير مقروء)</span> : null}
                    </p>
                    <span className="shrink-0 text-xs text-text-tertiary">{formatRelativeToNow(n.createdAt)}</span>
                  </div>
                  <p className="text-sm text-text-secondary">{n.body}</p>
                  <div className="mt-0.5 flex items-center gap-3 text-xs">
                    <span className="text-text-tertiary">{TYPE_LABEL[n.type] ?? n.type}</span>
                    {n.entityId ? (
                      <Link href={href} className="font-medium text-brand hover:text-brand/80" onClick={() => unread && markReadMutation.mutate(n.id)}>
                        عرض التفاصيل
                      </Link>
                    ) : null}
                    {unread ? (
                      <button
                        type="button"
                        onClick={() => markReadMutation.mutate(n.id)}
                        className="text-text-tertiary transition-colors hover:text-text-secondary focus-ring rounded-sm"
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
    </>
  );
}
