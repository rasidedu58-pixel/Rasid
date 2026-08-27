"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Badge, Button, Card, ErrorState, LoadingRegion, SectionCard, StatusDot, formatDate, formatRelativeToNow, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchAttentionCase, startFollowup, markMonitoring, closeAttentionCase } from "../../../../lib/api/attention";
import { fetchStudentDetail } from "../../../../lib/api/students";
import { ContactGuardianDialog } from "../../../../components/attention/contact-guardian-dialog";

const STATUS_LABEL: Record<string, string> = { NEW: "جديدة", IN_FOLLOWUP: "قيد المتابعة", CONTACTED: "تم التواصل", MONITORING: "تحت الملاحظة", CLOSED: "مغلقة" };
const RULE_LABEL: Record<string, string> = {
  ATTENDANCE_ABSENCE_STREAK: "غياب متكرر",
  HOMEWORK_NOT_DONE_STREAK: "تقصير متكرر في الواجب",
  LOW_EXAM_SCORE: "درجة امتحان منخفضة",
};

export default function AttentionCaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { workspaceId, canWrite } = useWorkspace();
  const queryClient = useQueryClient();
  const [contactOpen, setContactOpen] = useState(false);

  const caseQuery = useQuery({
    queryKey: workspaceId ? qk.attention.case(workspaceId, caseId) : ["attention-case", "none"],
    queryFn: () => fetchAttentionCase(workspaceId!, caseId),
    enabled: !!workspaceId,
  });

  const studentQuery = useQuery({
    queryKey: caseQuery.data && workspaceId ? qk.students.detail(workspaceId, caseQuery.data.student.id) : ["student", "none"],
    queryFn: () => fetchStudentDetail(workspaceId!, caseQuery.data!.student.id),
    enabled: !!workspaceId && !!caseQuery.data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.attention.case(workspaceId!, caseId) });
  const transitionOptions = { onSuccess: () => { invalidate(); toast.success("تم تحديث الحالة"); }, onError: () => toast.error("تعذّر تنفيذ الإجراء") };
  const startMutation = useMutation({ mutationFn: (v: number) => startFollowup(workspaceId!, caseId, { version: v }), ...transitionOptions });
  const monitoringMutation = useMutation({ mutationFn: (v: number) => markMonitoring(workspaceId!, caseId, { version: v }), ...transitionOptions });
  const closeMutation = useMutation({ mutationFn: (v: number) => closeAttentionCase(workspaceId!, caseId, { version: v }), ...transitionOptions });

  if (caseQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (caseQuery.isError || !caseQuery.data) return <ErrorState onRetry={() => caseQuery.refetch()} />;

  const item = caseQuery.data;
  const primaryGuardian = studentQuery.data?.guardians.find((g) => g.isPrimary) ?? studentQuery.data?.guardians[0];

  return (
    <>
      <PageHeader
        eyebrow="حالة متابعة"
        title={item.student.name}
        description={`كود الطالب: ${item.student.studentCode}`}
        actions={
          <div className="flex items-center gap-3">
            <StatusDot tone={item.priority === "HIGH" ? "danger" : "warning"} label={item.priority === "HIGH" ? "عاجلة" : "متوسطة"} />
            <Badge tone="neutral">{STATUS_LABEL[item.status] ?? item.status}</Badge>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <SectionCard title="أسباب ظهور الحالة" description="كل سبب مبني على قاعدة محددة وأدلة فعلية — لا تخمين.">
          <div className="flex flex-col gap-3">
            {item.reasons.map((reason) => (
              <Card key={reason.id} className={`border-s-2 p-3 ${reason.severity === "HIGH" ? "border-s-danger" : "border-s-warning"}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-text-primary">{RULE_LABEL[reason.ruleKey] ?? reason.ruleKey}</p>
                  <Badge tone={reason.severity === "HIGH" ? "danger" : "warning"}>{reason.severity === "HIGH" ? "عالية" : "متوسطة"}</Badge>
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  من {formatDate(reason.firstDetectedAt)} — {reason.evidence.length} دليل مسجّل
                </p>
              </Card>
            ))}
          </div>
        </SectionCard>

        {item.nextFollowUp || item.lastContact ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {item.lastContact ? (
              <div className="rounded-lg border border-border bg-surface px-4 py-3">
                <p className="text-xs font-medium text-text-tertiary">آخر تواصل</p>
                <p className="mt-1 text-sm font-medium text-text-primary">{formatRelativeToNow(item.lastContact.createdAt)}</p>
              </div>
            ) : null}
            {item.nextFollowUp ? (
              <div className="rounded-lg border border-brand/20 bg-brand-subtle/30 px-4 py-3">
                <p className="text-xs font-medium text-text-tertiary">المتابعة القادمة</p>
                <p className="mt-1 text-sm font-medium text-brand">{formatRelativeToNow(item.nextFollowUp.dueAt)}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {canWrite("CORE_OPERATIONS") ? (
          <SectionCard title="الإجراءات">
            <div className="flex flex-wrap gap-2">
              {primaryGuardian ? (
                <Button variant="outline" onClick={() => setContactOpen(true)}>
                  <MessageCircle className="h-4 w-4" aria-hidden />
                  التواصل مع ولي الأمر
                </Button>
              ) : (
                <Link href={`/students/${item.student.id}`} className="text-sm text-brand hover:underline">
                  أضف ولي أمر أولًا من صفحة الطالب
                </Link>
              )}
              {item.status === "NEW" ? (
                <Button variant="outline" onClick={() => startMutation.mutate(item.version)} loading={startMutation.isPending}>
                  بدء المتابعة
                </Button>
              ) : null}
              {item.status !== "MONITORING" && item.status !== "CLOSED" ? (
                <Button variant="outline" onClick={() => monitoringMutation.mutate(item.version)} loading={monitoringMutation.isPending}>
                  نقل إلى الملاحظة
                </Button>
              ) : null}
              {item.status !== "CLOSED" ? (
                <Button variant="outline" onClick={() => closeMutation.mutate(item.version)} loading={closeMutation.isPending}>
                  إغلاق الحالة
                </Button>
              ) : null}
            </div>
          </SectionCard>
        ) : null}
      </div>

      {contactOpen && primaryGuardian ? (
        <ContactGuardianDialog guardian={primaryGuardian} studentId={item.student.id} attentionCaseId={item.id} open onOpenChange={() => setContactOpen(false)} />
      ) : null}
    </>
  );
}
