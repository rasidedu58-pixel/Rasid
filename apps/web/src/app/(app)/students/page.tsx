"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { ActiveFilters, Badge, CursorPagination, EmptyState, ErrorState, FilterBar, FilterChip, SearchInput, SegmentedControl, SkeletonRows, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { useDebounce } from "../../../hooks/use-debounce";
import { fetchStudents } from "../../../lib/api/students";
import { CreateStudentDialog } from "./create-student-dialog";

// The search modes the students API actually supports (`searchBy`); "auto"
// lets the server infer name/code/phone from the query shape.
const SEARCH_MODES = [
  { value: "auto", label: "تلقائي" },
  { value: "name", label: "الاسم" },
  { value: "code", label: "الكود" },
  { value: "guardianPhone", label: "هاتف ولي الأمر" },
] as const;
type SearchMode = (typeof SEARCH_MODES)[number]["value"];
const MODE_LABEL: Record<SearchMode, string> = { auto: "تلقائي", name: "الاسم", code: "الكود", guardianPhone: "هاتف ولي الأمر" };
const MODE_PLACEHOLDER: Record<SearchMode, string> = {
  auto: "ابحث بالاسم أو الكود أو رقم ولي الأمر...",
  name: "ابحث باسم الطالب...",
  code: "ابحث بكود الطالب...",
  guardianPhone: "ابحث برقم هاتف ولي الأمر...",
};

export default function StudentsPage() {
  const { workspaceId } = useWorkspace();
  const [search, setSearch] = useState("");
  const [searchBy, setSearchBy] = useState<SearchMode>("auto");
  const debouncedSearch = useDebounce(search, 300);

  const query = useInfiniteQuery({
    queryKey: ["students", workspaceId, "list", debouncedSearch, searchBy],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      fetchStudents(workspaceId!, { q: debouncedSearch || undefined, searchBy: searchBy === "auto" ? undefined : searchBy, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled: !!workspaceId,
  });

  const students = query.data?.pages.flatMap((p) => p.items) ?? [];
  const hasNext = query.data?.pages[query.data.pages.length - 1]?.page.hasNext ?? false;
  const hasActiveFilters = search.trim().length > 0 || searchBy !== "auto";

  return (
    <>
      <PageHeader title="الطلاب" actions={<CreateStudentDialog />} />

      <FilterBar>
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={MODE_PLACEHOLDER[searchBy]} aria-label="البحث عن طالب" />
        <SegmentedControl aria-label="البحث حسب" options={SEARCH_MODES} value={searchBy} onChange={setSearchBy} />
      </FilterBar>

      {hasActiveFilters ? (
        <ActiveFilters
          onClearAll={() => {
            setSearch("");
            setSearchBy("auto");
          }}
          chips={
            <>
              {search.trim() ? <FilterChip label={`بحث: ${search.trim()}`} onRemove={() => setSearch("")} /> : null}
              {searchBy !== "auto" ? <FilterChip label={`الحقل: ${MODE_LABEL[searchBy]}`} onRemove={() => setSearchBy("auto")} /> : null}
            </>
          }
        />
      ) : null}

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
