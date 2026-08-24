"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import {
  Badge,
  CursorPagination,
  EmptyState,
  ErrorState,
  PermissionDeniedState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  formatDate,
} from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { fetchPlatformAdminSubscriptions } from "../../../lib/api/platform-admin";
import { isForbidden } from "../../../lib/api/client";

const STATES = ["TRIAL", "ACTIVE", "EXPIRING", "EXPIRED", "PAYMENT_FAILED", "CANCELLED_AT_PERIOD_END"] as const;
const STATE_LABEL: Record<string, string> = {
  TRIAL: "تجربة",
  ACTIVE: "نشط",
  EXPIRING: "قارب على الانتهاء",
  EXPIRED: "منتهٍ",
  PAYMENT_FAILED: "فشل الدفع",
  CANCELLED_AT_PERIOD_END: "سيُلغى نهاية الفترة",
};
const STATE_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  TRIAL: "neutral",
  ACTIVE: "success",
  EXPIRING: "warning",
  EXPIRED: "danger",
  PAYMENT_FAILED: "danger",
  CANCELLED_AT_PERIOD_END: "warning",
};

export default function PlatformAdminSubscriptionsPage() {
  const [state, setState] = useState<string | undefined>(undefined);

  const query = useInfiniteQuery({
    queryKey: ["platform-admin", "subscriptions", state],
    queryFn: ({ pageParam }: { pageParam?: string }) => fetchPlatformAdminSubscriptions({ state, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (isForbidden(query.error)) return <PermissionDeniedState />;

  const subscriptions = query.data?.pages.flatMap((p) => p.items) ?? [];
  const hasNext = query.data?.pages[query.data.pages.length - 1]?.page.hasNext ?? false;

  return (
    <>
      <PageHeader title="الاشتراكات" description="لا يوجد عمود سعر/إيراد في الاشتراكات بعد — لا أرقام مالية مُخترعة هنا." />

      <div className="mb-4 max-w-56">
        <Select value={state ?? "ALL"} onValueChange={(v) => setState(v === "ALL" ? undefined : v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">كل الحالات</SelectItem>
            {STATES.map((s) => (
              <SelectItem key={s} value={s}>{STATE_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={8} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : subscriptions.length === 0 ? (
        <EmptyState icon={<CreditCard className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد اشتراكات مطابقة" />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>مساحة العمل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>بداية الفترة</TableHead>
                  <TableHead>نهاية الفترة</TableHead>
                  <TableHead>يُلغى نهاية الفترة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Link href={`/platform-admin/workspaces/${s.workspaceId}`} className="font-medium text-text-primary hover:text-brand hover:underline">
                        {s.workspaceName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATE_TONE[s.state] ?? "neutral"}>{STATE_LABEL[s.state] ?? s.state}</Badge>
                    </TableCell>
                    <TableCell className="text-text-secondary">{s.periodStart ? formatDate(s.periodStart) : "—"}</TableCell>
                    <TableCell className="text-text-secondary">{s.periodEnd ? formatDate(s.periodEnd) : "—"}</TableCell>
                    <TableCell className="text-text-secondary">{s.cancelAtPeriodEnd ? "نعم" : "لا"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          <CursorPagination hasMore={hasNext} loading={query.isFetchingNextPage} loadedCount={subscriptions.length} onLoadMore={() => query.fetchNextPage()} />
        </>
      )}
    </>
  );
}
