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
import { CustomerCreate } from "../../../components/platform-admin/customer-create";
import { useDebounce } from "../../../hooks/use-debounce";
import { fetchPlatformAdminWorkspaces } from "../../../lib/api/platform-admin";
import { isForbidden } from "../../../lib/api/client";
import { SUB_STATE_LABEL, subStateTone } from "../../../lib/platform-labels";
import { useWorkspace } from "../../../lib/workspace-provider";
import { hasPlatformPermission } from "@academic-precision/contracts";

const STATE_FILTERS: Array<{ value: string | null; label: string }> = [
  { value: null, label: "الكل" },
  { value: "TRIAL", label: "تجربة" },
  { value: "ACTIVE", label: "نشط" },
  { value: "EXPIRED", label: "منتهٍ" },
  { value: "PAYMENT_FAILED", label: "فشل الدفع" },
  { value: "CANCELLED_AT_PERIOD_END", label: "سيُلغى" },
];

export default function PlatformAdminWorkspacesPage() {
  const { platformRole } = useWorkspace();
  const canViewSubs = hasPlatformPermission(platformRole, "platform.subscriptions.view");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<string | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const query = useInfiniteQuery({
    queryKey: ["platform-admin", "workspaces", debouncedSearch, state],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      fetchPlatformAdminWorkspaces({ search: debouncedSearch || undefined, state: state ?? undefined, cursor: pageParam, limit: 30 }),
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

      <CustomerCreate />

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم مساحة العمل..." className="ps-9" />
        </div>
        {canViewSubs ? (
        <div className="flex flex-wrap gap-1.5">
          {STATE_FILTERS.map((f) => {
            const active = state === f.value;
            return (
              <button
                key={f.label}
                type="button"
                onClick={() => setState(f.value)}
                className={
                  active
                    ? "rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground"
                    : "rounded-full border border-border px-3 py-1 text-xs font-medium text-text-secondary hover:bg-surface-sunken"
                }
              >
                {f.label}
              </button>
            );
          })}
        </div>
        ) : null}
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
                  {canViewSubs ? <TableHead>حالة الاشتراك</TableHead> : null}
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
                    {canViewSubs ? (
                      <TableCell>
                        {w.subscriptionState ? (
                          <Badge tone={subStateTone(w.subscriptionState)}>{SUB_STATE_LABEL[w.subscriptionState] ?? w.subscriptionState}</Badge>
                        ) : (
                          <span className="text-text-tertiary">—</span>
                        )}
                      </TableCell>
                    ) : null}
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
