"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Layers } from "lucide-react";
import { Badge, ErrorState, LoadingRegion, EmptyState } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchGroups } from "../../../lib/api/scheduling";
import { CreateGroupWizard } from "./create-group-wizard";

export default function GroupsPage() {
  const { workspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: workspaceId ? qk.groups.list(workspaceId) : ["groups", "none"],
    queryFn: () => fetchGroups(workspaceId!),
    enabled: !!workspaceId,
  });

  return (
    <>
      <PageHeader title="المجموعات" description="المجموعات الدائمة — الجدول والرسوم الشهرية تُدار من داخل كل مجموعة." actions={<CreateGroupWizard />} />

      {query.isLoading ? (
        <LoadingRegion />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.groups.length === 0 ? (
        <EmptyState icon={<Layers className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد مجموعات بعد" description="أنشئ أول مجموعة لتبدأ في جدولة الحصص وتسجيل الطلاب." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {query.data!.groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}`}
              className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand/40 hover:bg-brand-subtle/20"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-text-secondary group-hover:bg-brand-subtle group-hover:text-brand" aria-hidden>
                <Layers className="h-[18px] w-[18px]" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate font-semibold text-text-primary">{group.name}</h3>
                  <Badge tone={group.status === "ACTIVE" ? "success" : "neutral"} className="shrink-0">{group.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>
                </div>
                <p className="text-sm text-text-secondary">{[group.subject, group.grade].filter(Boolean).join(" · ") || "بدون تصنيف"}</p>
              </div>
              <ChevronLeft className="mt-1 h-4 w-4 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
