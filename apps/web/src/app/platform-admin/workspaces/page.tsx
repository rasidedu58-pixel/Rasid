"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Building2, Search } from "lucide-react";
import {
  Badge,
  CursorPagination,
  EmptyState,
  ErrorState,
  Input,
  PermissionDeniedState,
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
import { useDebounce } from "../../../hooks/use-debounce";
import { fetchPlatformAdminWorkspaces } from "../../../lib/api/platform-admin";
import { isForbidden } from "../../../lib/api/client";

const STATE_LABEL: Record<string, string> = {
  TRIAL: "تجربة",
  ACTIVE: "نشط",
  EXPIRING: "قارب على الانتهاء",
  EXPIRED: "منتهٍ",
  PAYMENT_FAILED: "فشل الدفع",
  CANCELLED_AT_PERIOD_END: "سيُلغى نهاية الفترة",
};

export default function PlatformAdminWorkspacesPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const query = useInfiniteQuery({
    queryKey: ["platform-admin", "workspaces", debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) => fetchPlatformAdminWorkspaces({ search: debouncedSearch || undefined, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (isForbidden(query.error)) return <PermissionDeniedState />;

  const workspaces = query.data?.pages.flatMap((p) => p.items) ?? [];
  const hasNext = query.data?.pages[query.data.pages.length - 1]?.page.hasNext ?? false;

  return (
    <>
      <PageHeader title="مساحات العمل" description="كل مساحات العمل عبر المنصة." />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم مساحة العمل..." className="ps-9" />
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={8} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : workspaces.length === 0 ? (
        <EmptyState icon={<Building2 className="h-8 w-8 text-text-tertiary" aria-hidden />} title={search ? "لا توجد نتائج مطابقة" : "لا توجد مساحات عمل بعد"} />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>المالك</TableHead>
                  <TableHead>حالة الاشتراك</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ الإنشاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      <Link href={`/platform-admin/workspaces/${w.id}`} className="font-medium text-text-primary hover:text-brand hover:underline">
                        {w.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-text-secondary">{w.ownerName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge tone="neutral">{w.subscriptionState ? (STATE_LABEL[w.subscriptionState] ?? w.subscriptionState) : "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge tone={w.status === "ACTIVE" ? "success" : "neutral"}>{w.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>
                    </TableCell>
                    <TableCell className="text-text-tertiary">{formatDate(w.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          <CursorPagination hasMore={hasNext} loading={query.isFetchingNextPage} loadedCount={workspaces.length} onLoadMore={() => query.fetchNextPage()} />
        </>
      )}
    </>
  );
}
