"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { Badge, Card, CardContent, ErrorState, LoadingRegion, EmptyState } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchGroups } from "../../../lib/api/scheduling";
import { CreateGroupDialog } from "./create-group-dialog";

export default function GroupsPage() {
  const { workspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: workspaceId ? qk.groups.list(workspaceId) : ["groups", "none"],
    queryFn: () => fetchGroups(workspaceId!),
    enabled: !!workspaceId,
  });

  return (
    <>
      <PageHeader title="المجموعات" description="المجموعات الدائمة — الجدول والرسوم الشهرية تُدار من داخل كل مجموعة." actions={<CreateGroupDialog />} />

      {query.isLoading ? (
        <LoadingRegion />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.groups.length === 0 ? (
        <EmptyState icon={<Layers className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد مجموعات بعد" description="أنشئ أول مجموعة لتبدأ في جدولة الحصص وتسجيل الطلاب." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {query.data!.groups.map((group) => (
            <Link key={group.id} href={`/groups/${group.id}`}>
              <Card className="h-full transition-shadow hover:shadow-sm">
                <CardContent className="flex flex-col gap-2 py-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-text-primary">{group.name}</h3>
                    <Badge tone={group.status === "ACTIVE" ? "success" : "neutral"}>{group.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {[group.subject, group.grade].filter(Boolean).join(" · ") || "بدون تصنيف"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
