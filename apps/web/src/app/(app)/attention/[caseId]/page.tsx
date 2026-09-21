"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessageCircle } from "lucide-react";
import { attentionReasonSummary, attentionRuleLabel } from "@academic-precision/contracts";
import type { AttentionEvidenceDto, AttentionReasonDto } from "@academic-precision/contracts";
import { Badge, Button, Card, ErrorState, LoadingRegion, SectionCard, StatusDot, cn, formatDate, formatRelativeToNow, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchAttentionCase, startFollowup, markMonitoring, closeAttentionCase } from "../../../../lib/api/attention";
import { fetchStudentDetail } from "../../../../lib/api/students";
import { ContactGuardianDialog } from "../../../../components/attention/contact-guardian-dialog";
// `ContactActivityList` is also untracked local WIP (part of the same
// unshipped offline/contact-logs tree) — its component file is not in
// git, so the online-only build ships without it. The list still comes
// back with the offline commit whenever that lands.
// `useOfflineRuntime` + `SyncStatusBadge` live under `apps/web/src/offline/*`
// which is untracked WIP (owner directive: no partial offline files enter
// git under this hotfix). The offline-integrated version of this page is
// preserved in git at commit 973ef7a — recover it later with
// `git show 973ef7a:apps/web/src/app/\(app\)/attention/\[caseId\]/page.tsx >
// apps/web/src/app/\(app\)/attention/\[caseId\]/page.tsx` once the offline
// PWA tree is committable. Phase 15 additions (reasonSummary + evidence
// rendering + empty states + honest labels) stay in on this online-only
// path.

const STATUS_LABEL: Record<string, string> = { NEW: "جديدة", IN_FOLLOWUP: "قيد المتابعة", CONTACTED: "تم التواصل", MONITORING: "تحت الملاحظة", CLOSED: "مغلقة" };
const EVIDENCE_SOURCE_LABEL: Record<string, string> = { SESSION_RECORD: "سجل حصة", SESSION: "حصة" };
const ATTENDANCE_STATUS_LABEL: Record<string, string> = { PRESENT: "حاضر", ABSENT: "غياب", LATE: "تأخير" };
const HOMEWORK_STATUS_LABEL: Record<string, string> = { DONE: "أدّى", PARTIAL: "أدى جزئيًا", NOT_DONE: "لم يؤدِ", NO_HOMEWORK: "لا يوجد واجب" };

/**
 * Human-safe description of a single evidence row from its `snapshot`.
 * The snapshot is an untyped freeform record (see `rule-engine.ts`) so we
 * ONLY surface a whitelist of stable fields — attendance / homework
 * status, or an exam score paired with its threshold. NEVER dumps raw
 * JSON to the teacher, and NEVER invents a description if the snapshot
 * doesn't carry a recognised signal (fall back to the source-type label
 * alone in that case).
 */
function evidenceLine(e: AttentionEvidenceDto): string {
  const snap = (e.snapshot ?? {}) as {
    attendanceStatus?: string;
    homeworkStatus?: string;
    examScore?: number;
    threshold?: number;
  };
  if (snap.attendanceStatus) {
    const label = ATTENDANCE_STATUS_LABEL[snap.attendanceStatus] ?? snap.attendanceStatus;
    return `الحضور: ${label}`;
  }
  if (snap.homeworkStatus) {
    const label = HOMEWORK_STATUS_LABEL[snap.homeworkStatus] ?? snap.homeworkStatus;
    return `الواجب: ${label}`;
  }
  if (typeof snap.examScore === "number") {
    return typeof snap.threshold === "number"
      ? `درجة الامتحان: ${snap.examScore} (الحد الأدنى ${snap.threshold})`
      : `درجة الامتحان: ${snap.examScore}`;
  }
  return EVIDENCE_SOURCE_LABEL[e.sourceType] ?? e.sourceType;
}

/**
 * Progressive disclosure for a reason's evidence. Renders the honest
 * fields from each evidence's `snapshot` via `evidenceLine`, alongside
 * the source kind and observation date. Collapsed by default. If the
 * reason has zero evidence rows, the caller renders an explicit honest
 * empty state instead of this collapsible.
 */
function ReasonEvidence({ evidence }: { evidence: AttentionEvidenceDto[] }) {
  const [open, setOpen] = useState(false);
  if (evidence.length === 0) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex items-center gap-1 rounded-sm text-xs font-medium text-brand hover:underline"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        {open ? "إخفاء الأدلة" : `عرض الأدلة (${evidence.length})`}
      </button>
      {open ? (
        <ul className="mt-2 flex flex-col gap-1.5 border-s-2 border-border ps-3">
          {evidence.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-2 text-xs text-text-secondary">
              <span className="min-w-0">
                <span className="block">{evidenceLine(e)}</span>
                <span className="mt-0.5 block text-[11px] text-text-tertiary">{EVIDENCE_SOURCE_LABEL[e.sourceType] ?? e.sourceType}</span>
              </span>
              <span className="shrink-0 tabular-nums text-text-tertiary">{formatDate(e.observedAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Honest empty state for a reason that has no evidence rows attached —
 * happens for legacy rows before the rule engine started writing evidence
 * atomically. Never fabricates a signal.
 */
function ReasonEmpty() {
  return (
    <p className="mt-2 text-xs text-text-tertiary">لا توجد أدلة تفصيلية مسجّلة لهذا السبب.</p>
  );
}

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
  if (caseQuery.isError || !caseQuery.data) {
    // Online-only: a fetch failure is a full-page error with a retry. The
    // offline-aware fallback (which showed the still-durable local
    // ContactActivityList) is preserved in git at 973ef7a — it comes back
    // when the offline PWA tree is committed.
    return <ErrorState onRetry={() => caseQuery.refetch()} />;
  }

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
        <SectionCard title="سبب المتابعة" description="كل سبب مبني على قاعدة محددة وأدلة فعلية — لا تخمين.">
          {item.reasons.length === 0 ? (
            <p className="text-sm text-text-secondary">
              لم يُسجَّل سبب تفصيلي لهذه الحالة بعد.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {item.reasons.map((reason: AttentionReasonDto) => (
                <Card key={reason.id} className={`border-s-2 p-3 ${reason.severity === "HIGH" ? "border-s-danger" : "border-s-warning"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-text-primary">{attentionRuleLabel(reason.ruleKey)}</p>
                    <Badge tone={reason.severity === "HIGH" ? "danger" : "warning"}>{reason.severity === "HIGH" ? "عالية" : "متوسطة"}</Badge>
                  </div>
                  {/* Human summary sentence — count derived from real snapshot
                      fields (never a raw `evidence.length` heuristic), with
                      the "آخر رصد" date attached. */}
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">{attentionReasonSummary(reason)}</p>
                  <p className="mt-1 text-xs text-text-tertiary">
                    فُتحت منذ {formatDate(reason.firstDetectedAt)}
                  </p>
                  {reason.evidence.length === 0 ? <ReasonEmpty /> : <ReasonEvidence evidence={reason.evidence} />}
                </Card>
              ))}
            </div>
          )}
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

        {/* ContactActivityList lives with the offline WIP tree — see the
            import comment. Restored automatically when that tree is
            committed. */}

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
