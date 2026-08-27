"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronLeft } from "lucide-react";
import { Badge, EmptyState, ErrorState, SkeletonRows, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, cn, formatDateTime } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchSessions } from "../../../lib/api/scheduling";

const STATUS_LABEL: Record<string, { label: string; tone: "brand" | "success" | "neutral" | "danger" | "warning" }> = {
  SCHEDULED: { label: "مجدولة", tone: "neutral" },
  IN_PROGRESS: { label: "جارية", tone: "brand" },
  COMPLETED: { label: "مكتملة", tone: "success" },
  CANCELLED: { label: "ملغاة", tone: "danger" },
  RESCHEDULED: { label: "مؤجّلة", tone: "warning" },
};

export default function SessionsPage() {
  const { workspaceId } = useWorkspace();
  const router = useRouter();
  const query = useQuery({
    queryKey: workspaceId ? qk.sessions.list(workspaceId, {}) : ["sessions", "none"],
    queryFn: () => fetchSessions(workspaceId!, { limit: 50 }),
    enabled: !!workspaceId,
  });

  return (
    <>
      <PageHeader title="الحصص" description="كل الحصص عبر مجموعاتك — افتح أي حصة للدخول إلى وضع الحصة." />

      {query.isLoading ? (
        <SkeletonRows rows={6} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.items.length === 0 ? (
        <EmptyState icon={<CalendarClock className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد حصص" description="ستظهر هنا حصص المجموعات بعد جدولتها." />
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموعد</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="w-8" aria-label="فتح" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data!.items.map((session) => {
                const status = STATUS_LABEL[session.status] ?? { label: session.status, tone: "neutral" as const };
                const live = session.status === "IN_PROGRESS";
                return (
                  <TableRow
                    key={session.id}
                    className={cn("group cursor-pointer transition-colors hover:bg-surface-sunken/50", live && "bg-brand-subtle/25")}
                    onClick={() => router.push(`/sessions/${session.id}`)}
                  >
                    <TableCell>
                      <Link href={`/sessions/${session.id}`} className="flex items-center gap-2 font-medium text-text-primary group-hover:text-brand" onClick={(e) => e.stopPropagation()}>
                        {live ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden /> : null}
                        <span className="tabular-nums">{formatDateTime(session.scheduledAt)}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-text-tertiary">
                      <ChevronLeft className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      )}
    </>
  );
}
