"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import { Badge, EmptyState, ErrorState, SkeletonRows, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, formatDateTime } from "@academic-precision/ui";
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data!.items.map((session) => {
                const status = STATUS_LABEL[session.status] ?? { label: session.status, tone: "neutral" as const };
                return (
                  <TableRow key={session.id}>
                    <TableCell>
                      <Link href={`/sessions/${session.id}`} className="font-medium text-text-primary hover:text-brand hover:underline">
                        {formatDateTime(session.scheduledAt)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge tone={status.tone}>{status.label}</Badge>
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
