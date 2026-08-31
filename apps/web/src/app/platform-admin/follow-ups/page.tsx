"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Card, CardContent, ErrorState, LoadingRegion, PermissionDeniedState, cn, formatDateTime, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { qk } from "../../../lib/query-keys";
import { fetchFollowUpQueue, updateFollowUp } from "../../../lib/api/platform-operations";
import { fetchMe } from "../../../lib/api/identity";
import { isForbidden } from "../../../lib/api/client";
import { FOLLOW_UP_STATUS_LABEL, followUpStatusTone } from "../../../lib/platform-labels";
import type { FollowUp } from "@academic-precision/contracts";

type Scope = "PENDING" | "OVERDUE" | "TODAY" | "MINE" | "DONE" | "ALL";
const SCOPES: { key: Scope; label: string }[] = [
  { key: "PENDING", label: "قيد المتابعة" },
  { key: "OVERDUE", label: "المتأخرة" },
  { key: "TODAY", label: "اليوم" },
  { key: "MINE", label: "المُسندة إليّ" },
  { key: "DONE", label: "المكتملة" },
  { key: "ALL", label: "الكل" },
];

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function FollowUpQueuePage() {
  const [scope, setScope] = useState<Scope>("PENDING");
  const me = useQuery({ queryKey: qk.me(), queryFn: fetchMe });
  const myUserId = me.data?.user.id;

  // Server-side params per scope; OVERDUE/TODAY are client-derived over PENDING.
  const status = scope === "DONE" ? "DONE" : scope === "ALL" ? undefined : "PENDING";
  const assignedToUserId = scope === "MINE" ? myUserId : undefined;

  const query = useQuery({
    queryKey: qk.platformAdmin.followUpQueue({ status: status ?? "ALL", assignedToUserId: assignedToUserId ?? null }),
    queryFn: () => fetchFollowUpQueue({ status, assignedToUserId }),
    enabled: scope !== "MINE" || !!myUserId,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  const items = useMemo(() => {
    const list = query.data?.items ?? [];
    if (scope === "OVERDUE") return list.filter((f) => f.dueAt && new Date(f.dueAt).getTime() < Date.now());
    if (scope === "TODAY") return list.filter((f) => f.dueAt && isToday(f.dueAt));
    return list;
  }, [query.data, scope]);

  if (query.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (isForbidden(query.error)) return <PermissionDeniedState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="قائمة المتابعة" description="كل مهام متابعة العملاء عبر المنصة — مرتّبة بالأحدث." />

      <div className="flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setScope(s.key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
              scope === s.key ? "border-brand bg-brand/10 text-brand" : "border-border text-text-secondary hover:bg-surface-sunken",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-text-tertiary">لا توجد متابعات في هذا التصنيف.</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {items.map((f) => (
              <QueueRow key={f.id} followUp={f} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QueueRow({ followUp }: { followUp: FollowUp }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (next: "DONE" | "CANCELLED") => updateFollowUp(followUp.id, { status: next }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-admin", "follow-ups"] });
      queryClient.invalidateQueries({ queryKey: qk.platformAdmin.workspaceFollowUps(followUp.workspaceId) });
      toast.success("تم تحديث المتابعة");
    },
    onError: () => toast.error("تعذّر تحديث المتابعة"),
  });
  const isPending = followUp.status === "PENDING";
  const overdue = isPending && followUp.dueAt ? new Date(followUp.dueAt).getTime() < Date.now() : false;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge tone={followUpStatusTone(followUp.status)}>{FOLLOW_UP_STATUS_LABEL[followUp.status] ?? followUp.status}</Badge>
          <span className="truncate text-sm font-medium text-text-primary">{followUp.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
          <Link href={`/platform-admin/workspaces/${followUp.workspaceId}`} className="text-brand hover:underline">
            {followUp.workspaceName ?? "—"}
          </Link>
          {followUp.assignedToName ? <span>· {followUp.assignedToName}</span> : <span>· غير مُسندة</span>}
          {followUp.dueAt ? (
            <span className={cn(overdue ? "font-medium text-danger" : "")}>· {overdue ? "متأخرة" : "تُستحق"} {formatDateTime(followUp.dueAt)}</span>
          ) : null}
        </div>
      </div>
      {isPending ? (
        <div className="flex shrink-0 items-center gap-3 text-sm">
          <button type="button" onClick={() => mutation.mutate("DONE")} disabled={mutation.isPending} className="font-medium text-brand hover:underline disabled:opacity-50">
            تمّت
          </button>
          <button type="button" onClick={() => mutation.mutate("CANCELLED")} disabled={mutation.isPending} className="text-text-tertiary hover:text-danger hover:underline disabled:opacity-50">
            إلغاء
          </button>
        </div>
      ) : null}
    </div>
  );
}
