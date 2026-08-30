"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
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
import { fetchPlatformAdminUsers } from "../../../lib/api/platform-admin";
import { isForbidden } from "../../../lib/api/client";

export default function PlatformAdminUsersPage() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const query = useInfiniteQuery({
    queryKey: ["platform-admin", "users", debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) => fetchPlatformAdminUsers({ search: debouncedSearch || undefined, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (isForbidden(query.error)) return <PermissionDeniedState />;

  const users = query.data?.pages.flatMap((p) => p.items) ?? [];
  const hasNext = query.data?.pages[query.data.pages.length - 1]?.page.hasNext ?? false;

  return (
    <>
      <PageHeader title="المستخدمون" description="بحث عبر كل مساحات العمل — بدون كلمات مرور أو رموز دخول." />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو البريد أو الهاتف..." className="ps-9" />
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={8} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : users.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-text-tertiary" aria-hidden />} title={search ? "لا توجد نتائج مطابقة" : "لا يوجد مستخدمون بعد"} />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>البريد الإلكتروني</TableHead>
                  <TableHead>مساحات العمل</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>تاريخ التسجيل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link href={`/platform-admin/users/${u.id}`} className="font-medium text-text-primary hover:text-brand hover:underline">
                        {u.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-text-secondary">{u.emailDisplay ?? "—"}</TableCell>
                    <TableCell className="tabular-nums text-text-secondary">{u.workspaceCount}</TableCell>
                    <TableCell>
                      <Badge tone={u.status === "ACTIVE" ? "success" : "neutral"}>{u.status === "ACTIVE" ? "نشط" : u.status}</Badge>
                    </TableCell>
                    <TableCell className="text-text-tertiary">{formatDate(u.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          <CursorPagination hasMore={hasNext} loading={query.isFetchingNextPage} loadedCount={users.length} onLoadMore={() => query.fetchNextPage()} />
        </>
      )}
    </>
  );
}
