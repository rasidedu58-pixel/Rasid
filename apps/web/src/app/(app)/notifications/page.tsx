"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, SkeletonRows, cn, formatRelativeToNow, toast } from "@academic-precision/ui";
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
        <div className="flex flex-col gap-2">
          {query.data!.notifications.map((n) => {
            const href = actionItemHref(n.entityType ?? "", n.entityId ?? "");
            return (
              <Card key={n.id} className={cn("flex items-start gap-3 p-4", !n.readAt && "border-brand/30 bg-brand-subtle/20")}>
                <div className={cn("mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", n.readAt ? "bg-surface-sunken" : "bg-brand-subtle")}>
                  <BellRing className={cn("h-4 w-4", n.readAt ? "text-text-tertiary" : "text-brand")} aria-hidden />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text-primary">{n.title}</p>
                    {!n.readAt ? <Badge tone="brand">جديد</Badge> : null}
                  </div>
                  <p className="text-sm text-text-secondary">{n.body}</p>
                  <div className="flex items-center gap-3 text-xs text-text-tertiary">
                    <span>{TYPE_LABEL[n.type] ?? n.type}</span>
                    <span>{formatRelativeToNow(n.createdAt)}</span>
                    {n.entityId ? (
                      <Link href={href} className="text-brand hover:underline" onClick={() => !n.readAt && markReadMutation.mutate(n.id)}>
                        عرض التفاصيل
                      </Link>
                    ) : null}
                  </div>
                </div>
                {!n.readAt ? (
                  <Button variant="ghost" size="sm" onClick={() => markReadMutation.mutate(n.id)}>
                    تعليم كمقروء
                  </Button>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
