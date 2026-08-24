"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { Badge, CursorPagination, EmptyState, ErrorState, Input, SkeletonRows, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { useDebounce } from "../../../hooks/use-debounce";
import { fetchStudents } from "../../../lib/api/students";
import { CreateStudentDialog } from "./create-student-dialog";

export default function StudentsPage() {
  const { workspaceId } = useWorkspace();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const query = useInfiniteQuery({
    queryKey: ["students", workspaceId, "list", debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) => fetchStudents(workspaceId!, { q: debouncedSearch || undefined, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled: !!workspaceId,
  });

  const students = query.data?.pages.flatMap((p) => p.items) ?? [];
  const hasNext = query.data?.pages[query.data.pages.length - 1]?.page.hasNext ?? false;

  return (
    <>
      <PageHeader title="الطلاب" actions={<CreateStudentDialog />} />

      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو كود الطالب..." className="ps-9" />
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={6} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : students.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-text-tertiary" aria-hidden />} title={search ? "لا توجد نتائج مطابقة" : "لا يوجد طلاب بعد"} description={search ? "جرّب كلمة بحث مختلفة." : "أضف أول طالب لتبدأ."} />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الاسم</TableHead>
                  <TableHead>الكود</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell>
                      <Link href={`/students/${student.id}`} className="font-medium text-text-primary hover:text-brand hover:underline">
                        {student.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-text-secondary">{student.studentCode}</TableCell>
                    <TableCell>
                      <Badge tone={student.status === "ACTIVE" ? "success" : "neutral"}>{student.status === "ACTIVE" ? "نشط" : "مؤرشف"}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          <CursorPagination hasMore={hasNext} loading={query.isFetchingNextPage} loadedCount={students.length} onLoadMore={() => query.fetchNextPage()} />
        </>
      )}
    </>
  );
}
