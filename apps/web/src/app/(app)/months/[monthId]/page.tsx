"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { Badge, Card, CardContent, EmptyState, ErrorState, LoadingRegion, formatMoney, formatMonthLabel } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchMonth, fetchGroupMonthsForMonth, fetchGroups } from "../../../../lib/api/scheduling";

/**
 * Operating Month detail — lists every GroupMonth this month resolves to,
 * each linking to `/group-months/:id` for fee/schedule/roster management.
 * `GET /months/:id/group-months` is the Phase 11 Closure Delta addition
 * that makes this reachable at all (see the contract's own comment).
 */
export default function MonthDetailPage() {
  const { monthId } = useParams<{ monthId: string }>();
  const { workspaceId } = useWorkspace();

  const monthQuery = useQuery({
    queryKey: workspaceId ? qk.months.detail(workspaceId, monthId) : ["month", "none"],
    queryFn: () => fetchMonth(workspaceId!, monthId),
    enabled: !!workspaceId,
  });
  const groupMonthsQuery = useQuery({
    queryKey: workspaceId ? qk.months.groupMonths(workspaceId, monthId) : ["group-months-for-month", "none"],
    queryFn: () => fetchGroupMonthsForMonth(workspaceId!, monthId),
    enabled: !!workspaceId,
  });
  const groupsQuery = useQuery({
    queryKey: workspaceId ? qk.groups.list(workspaceId) : ["groups", "none"],
    queryFn: () => fetchGroups(workspaceId!),
    enabled: !!workspaceId,
  });

  if (monthQuery.isLoading || groupMonthsQuery.isLoading || groupsQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (monthQuery.isError || groupMonthsQuery.isError || groupsQuery.isError || !monthQuery.data || !groupMonthsQuery.data || !groupsQuery.data) {
    return (
      <ErrorState
        onRetry={() => {
          monthQuery.refetch();
          groupMonthsQuery.refetch();
          groupsQuery.refetch();
        }}
      />
    );
  }

  const month = monthQuery.data;
  const groupNameById = new Map(groupsQuery.data.groups.map((g) => [g.id, g.name]));

  return (
    <>
      <PageHeader
        title={formatMonthLabel(month.year, month.month)}
        actions={<Badge tone={month.status === "CURRENT" ? "success" : "neutral"}>{month.status === "CURRENT" ? "حالي" : "مؤرشف"}</Badge>}
      />

      {groupMonthsQuery.data.groupMonths.length === 0 ? (
        <EmptyState icon={<Layers className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد مجموعات في هذا الشهر" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groupMonthsQuery.data.groupMonths.map((gm) => (
            <Link key={gm.id} href={`/group-months/${gm.id}`}>
              <Card className="h-full transition-shadow hover:shadow-sm">
                <CardContent className="flex flex-col gap-2 py-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-text-primary">{groupNameById.get(gm.groupId) ?? "مجموعة"}</h3>
                    <Badge tone={gm.monthlyStatus === "ACTIVE" ? "success" : "neutral"}>{gm.monthlyStatus === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>
                  </div>
                  <p className="text-sm text-text-secondary">{formatMoney(gm.baseFeeMinor, gm.currencyCode)} شهريًا</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
