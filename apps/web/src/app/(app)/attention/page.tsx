"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HeartHandshake } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, SkeletonRows, Tabs, TabsContent, TabsList, TabsTrigger, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, formatRelativeToNow, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { completeFollowup, fetchAttentionCases, fetchFollowups } from "../../../lib/api/attention";

const STATUS_LABEL: Record<string, string> = { NEW: "جديدة", IN_FOLLOWUP: "قيد المتابعة", CONTACTED: "تم التواصل", MONITORING: "تحت الملاحظة", CLOSED: "مغلقة" };
const PRIORITY_TONE: Record<string, "danger" | "warning"> = { HIGH: "danger", MEDIUM: "warning" };

export default function AttentionPage() {
  const [tab, setTab] = useState<"cases" | "followups">("cases");
  return (
    <>
      <PageHeader title="المتابعة" description="كل حالة موضّح سببها ودليلها — بدون تخمين." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "cases" | "followups")} dir="rtl">
        <TabsList>
          <TabsTrigger value="cases">الحالات</TabsTrigger>
          <TabsTrigger value="followups">المتابعات المجدولة</TabsTrigger>
        </TabsList>
        <TabsContent value="cases">
          <CasesList />
        </TabsContent>
        <TabsContent value="followups">
          <FollowupsList />
        </TabsContent>
      </Tabs>
    </>
  );
}

function CasesList() {
  const { workspaceId } = useWorkspace();
  const query = useQuery({
    queryKey: workspaceId ? qk.attention.cases(workspaceId, {}) : ["cases", "none"],
    queryFn: () => fetchAttentionCases(workspaceId!, { limit: 50 }),
    enabled: !!workspaceId,
  });

  if (query.isLoading) return <SkeletonRows rows={5} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (query.data!.items.length === 0) {
    return <EmptyState icon={<HeartHandshake className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد حالات متابعة حاليًا" description="ستظهر هنا أي حالة يكتشفها النظام تلقائيًا بسبب واضح." />;
  }

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الطالب</TableHead>
            <TableHead>الأولوية</TableHead>
            <TableHead>الحالة</TableHead>
            <TableHead>آخر تحديث</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data!.items.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link href={`/attention/${c.id}`} className="font-medium text-text-primary hover:text-brand hover:underline">
                  {c.studentName}
                </Link>
              </TableCell>
              <TableCell>
                <Badge tone={PRIORITY_TONE[c.priority] ?? "neutral"}>{c.priority === "HIGH" ? "عاجلة" : "متوسطة"}</Badge>
              </TableCell>
              <TableCell className="text-text-secondary">{STATUS_LABEL[c.status] ?? c.status}</TableCell>
              <TableCell className="text-text-tertiary">{formatRelativeToNow(c.lastQualifiedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}

function FollowupsList() {
  const { workspaceId, canWrite } = useWorkspace();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: workspaceId ? qk.attention.followups(workspaceId, {}) : ["followups", "none"],
    queryFn: () => fetchFollowups(workspaceId!, { status: "PENDING", limit: 50 }),
    enabled: !!workspaceId,
  });

  const completeMutation = useMutation({
    mutationFn: (followup: { id: string; version: number }) => completeFollowup(workspaceId!, followup.id, { version: followup.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.attention.followups(workspaceId!, {}) });
      toast.success("تم إنهاء المتابعة");
    },
    onError: () => toast.error("تعذّر إنهاء المتابعة"),
  });

  if (query.isLoading) return <SkeletonRows rows={5} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (query.data!.items.length === 0) {
    return <EmptyState icon={<HeartHandshake className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد متابعات مجدولة" />;
  }

  return (
    <TableScroll>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الموعد</TableHead>
            <TableHead>الحالة المرتبطة</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data!.items.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="text-text-primary">{formatRelativeToNow(f.dueAt)}</TableCell>
              <TableCell>
                <Link href={`/attention/${f.attentionCaseId}`} className="text-brand hover:underline">
                  عرض الحالة
                </Link>
              </TableCell>
              <TableCell>
                {canWrite("CORE_OPERATIONS") ? (
                  <Button size="sm" variant="outline" onClick={() => completeMutation.mutate(f)} loading={completeMutation.isPending}>
                    تم التنفيذ
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableScroll>
  );
}
