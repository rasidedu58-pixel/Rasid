"use client";

import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Card,
  ErrorState,
  LoadingRegion,
  PermissionDeniedState,
  SectionCard,
  formatDate,
  formatDateTime,
} from "@academic-precision/ui";
import { CheckCircle2, AlertTriangle, MinusCircle } from "lucide-react";
import { PageHeader } from "../../../../components/shell/page-header";
import { qk } from "../../../../lib/query-keys";
import { fetchPlatformAdminWorkspace, fetchPlatformWorkspaceOperational } from "../../../../lib/api/platform-admin";
import { isForbidden } from "../../../../lib/api/client";
import {
  CAPABILITY_LABEL,
  MEMBER_STATUS_LABEL,
  SUB_STATE_LABEL,
  monthLabel,
  subStateTone,
} from "../../../../lib/platform-labels";

export default function CustomerDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const wsQuery = useQuery({
    queryKey: qk.platformAdmin.workspace(workspaceId),
    queryFn: () => fetchPlatformAdminWorkspace(workspaceId),
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });
  const opQuery = useQuery({
    queryKey: qk.platformAdmin.workspaceOperational(workspaceId),
    queryFn: () => fetchPlatformWorkspaceOperational(workspaceId),
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (wsQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (isForbidden(wsQuery.error)) return <PermissionDeniedState />;
  if (wsQuery.isError || !wsQuery.data) return <ErrorState onRetry={() => wsQuery.refetch()} />;

  const w = wsQuery.data;
  const op = opQuery.data;
  const owner = w.members.find((m) => m.roleLabel === "OWNER");
  const sub = w.subscription;
  const subActive = sub ? !["EXPIRED", "PAYMENT_FAILED"].includes(sub.state) : false;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="العميل"
        title={w.name}
        description={owner?.fullName ? `المالك: ${owner.fullName}${owner.emailDisplay ? ` · ${owner.emailDisplay}` : ""}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {sub ? <Badge tone={subStateTone(sub.state)}>{SUB_STATE_LABEL[sub.state] ?? sub.state}</Badge> : null}
            <Badge tone={w.status === "ACTIVE" ? "success" : "neutral"}>{w.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>
          </div>
        }
      />

      {/* Support diagnostic — the "why might it not be working" at-a-glance panel */}
      <SectionCard title="تشخيص الدعم" description="نظرة سريعة تجيب: أين المشكلة المحتملة؟">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Signal
            ok={w.status === "ACTIVE"}
            label="الحساب / مساحة العمل"
            value={w.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}
          />
          <Signal
            ok={subActive}
            label="الاشتراك"
            value={sub ? `${SUB_STATE_LABEL[sub.state] ?? sub.state}${sub.periodEnd ? ` — حتى ${formatDate(sub.periodEnd)}` : ""}` : "لا يوجد"}
          />
          {op?.available ? (
            <>
              <Signal ok={!!op.currentMonth} label="الشهر التشغيلي" value={op.currentMonth ? monthLabel(op.currentMonth.year, op.currentMonth.month) : "لا يوجد شهر حالي"} />
              <Signal ok={(op.studentsCount ?? 0) > 0} label="الطلاب / المجموعات" value={`${op.studentsCount ?? 0} طالب · ${op.groupsCount ?? 0} مجموعة`} neutralWhenFalse />
            </>
          ) : (
            <Signal state="unknown" label="اللقطة التشغيلية" value="تتطلب تفعيل صلاحيات القراءة (migration 0055)" />
          )}
        </div>
      </SectionCard>

      {/* Operational snapshot */}
      <SectionCard title="اللقطة التشغيلية">
        {opQuery.isLoading ? (
          <p className="text-sm text-text-tertiary">جارٍ التحميل…</p>
        ) : opQuery.isError ? (
          <p className="text-sm text-danger">
            تعذّر تحميل اللقطة التشغيلية (خطأ في الطلب).{" "}
            <code className="text-xs">{String((opQuery.error as { code?: string })?.code ?? "")} {String((opQuery.error as Error)?.message ?? opQuery.error)}</code>
          </p>
        ) : op?.available ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
            <MiniStat label="الشهر الحالي" value={op.currentMonth ? monthLabel(op.currentMonth.year, op.currentMonth.month) : "—"} />
            <MiniStat label="المجموعات" value={String(op.groupsCount ?? 0)} />
            <MiniStat label="الطلاب" value={String(op.studentsCount ?? 0)} />
            <MiniStat label="التسجيلات النشطة" value={String(op.activeEnrollmentsCount ?? 0)} />
            <MiniStat label="حصص الشهر" value={op.sessionsThisMonth ? `${op.sessionsThisMonth.completed}/${op.sessionsThisMonth.total}` : "—"} />
            <MiniStat label="آخر نشاط" value={op.lastActivityAt ? formatDate(op.lastActivityAt) : "—"} />
          </div>
        ) : (
          <div className="text-sm text-text-secondary">
            بيانات التشغيل غير متاحة لدور القراءة بعد — تُفعَّل بتطبيق migration الصلاحيات <code className="text-xs">0055</code> (لم يُطبَّق على Production تلقائيًا).
            {op?.debug ? (
              <p className="mt-2 text-xs text-danger">
                سبب تشخيصي: <code>{op.debug}</code>
              </p>
            ) : null}
          </div>
        )}
      </SectionCard>

      {/* Account / workspace facts */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-text-secondary">المالك</p>
          <Link href={`/platform-admin/users/${w.ownerUserId}`} className="mt-1 block truncate text-sm font-medium text-brand hover:underline">
            {w.ownerName ?? "—"}
          </Link>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-secondary">المنطقة الزمنية</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{w.timezone}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-secondary">سياسة الاستحقاق</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{w.dueDatePolicy === "UNIFIED" ? "موحّدة" : "لكل مجموعة"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-secondary">تاريخ الإنشاء</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{formatDate(w.createdAt)}</p>
        </Card>
      </div>

      {/* Subscription snapshot */}
      <SectionCard title="الاشتراك">
        {!sub ? (
          <p className="text-sm text-text-secondary">لا يوجد اشتراك مسجّل.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MiniStat label="الحالة" value={SUB_STATE_LABEL[sub.state] ?? sub.state} />
            <MiniStat label="المزوّد" value={sub.provider} />
            <MiniStat label="بداية الفترة" value={sub.periodStart ? formatDate(sub.periodStart) : "—"} />
            <MiniStat label="نهاية الفترة" value={sub.periodEnd ? formatDateTime(sub.periodEnd) : "—"} />
          </div>
        )}
      </SectionCard>

      {/* Members */}
      <SectionCard title={`الفريق (${w.members.length})`}>
        <ul className="flex flex-col divide-y divide-border">
          {w.members.map((m) => (
            <li key={m.userId}>
              <Link href={`/platform-admin/users/${m.userId}`} className="flex items-center justify-between gap-2 py-2.5 hover:bg-surface-sunken">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium text-text-primary">{m.fullName}</span>
                  <span className="truncate text-xs text-text-tertiary">{m.emailDisplay ?? "—"}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-text-tertiary">
                  {m.roleLabel === "OWNER" ? "مالك" : m.roleLabel}
                  <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{MEMBER_STATUS_LABEL[m.status] ?? m.status}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* Entitlements */}
      <SectionCard title="الصلاحيات الفعّالة">
        {w.entitlements.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد صلاحيات فعّالة حاليًا.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {w.entitlements.map((e) => (
              <Badge key={e.capability} tone={e.state === "ALLOWED" ? "success" : "danger"}>
                {CAPABILITY_LABEL[e.capability] ?? e.capability}: {e.state === "ALLOWED" ? "مسموح" : "محظور"}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Signal({
  ok,
  state,
  label,
  value,
  neutralWhenFalse,
}: {
  ok?: boolean;
  state?: "unknown";
  label: string;
  value: string;
  neutralWhenFalse?: boolean;
}) {
  const resolved: "ok" | "warn" | "unknown" = state === "unknown" ? "unknown" : ok ? "ok" : neutralWhenFalse ? "unknown" : "warn";
  const icon: ReactNode =
    resolved === "ok" ? (
      <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
    ) : resolved === "warn" ? (
      <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
    ) : (
      <MinusCircle className="h-4 w-4 text-text-tertiary" aria-hidden />
    );
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
      <span className="mt-0.5">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="text-xs text-text-tertiary">{label}</span>
        <span className="truncate text-sm font-medium text-text-primary">{value}</span>
      </span>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-sm font-medium text-text-primary">{value}</p>
    </div>
  );
}
