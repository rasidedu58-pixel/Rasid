"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardContent, ErrorState, LoadingRegion, PermissionDeniedState, SectionCard, formatDate } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { qk } from "../../../../lib/query-keys";
import { fetchPlatformAdminWorkspace } from "../../../../lib/api/platform-admin";
import { isForbidden } from "../../../../lib/api/client";

const STATE_LABEL: Record<string, string> = {
  TRIAL: "تجربة",
  ACTIVE: "نشط",
  EXPIRING: "قارب على الانتهاء",
  EXPIRED: "منتهٍ",
  PAYMENT_FAILED: "فشل الدفع",
  CANCELLED_AT_PERIOD_END: "سيُلغى نهاية الفترة",
};

export default function PlatformAdminWorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const query = useQuery({
    queryKey: qk.platformAdmin.workspace(workspaceId),
    queryFn: () => fetchPlatformAdminWorkspace(workspaceId),
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (query.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (isForbidden(query.error)) return <PermissionDeniedState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const w = query.data;

  return (
    <>
      <PageHeader
        title={w.name}
        actions={<Badge tone={w.status === "ACTIVE" ? "success" : "neutral"}>{w.status === "ACTIVE" ? "نشطة" : "مؤرشفة"}</Badge>}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-text-secondary">المالك</p>
          <Link href={`/platform-admin/users/${w.ownerUserId}`} className="mt-1 block text-sm font-medium text-brand hover:underline">
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

      <SectionCard title="الاشتراك" className="mt-4">
        {!w.subscription ? (
          <p className="text-sm text-text-secondary">لا يوجد اشتراك مسجّل.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <MiniStat label="الحالة" value={STATE_LABEL[w.subscription.state] ?? w.subscription.state} />
            <MiniStat label="بداية الفترة" value={w.subscription.periodStart ? formatDate(w.subscription.periodStart) : "—"} />
            <MiniStat label="نهاية الفترة" value={w.subscription.periodEnd ? formatDate(w.subscription.periodEnd) : "—"} />
            <MiniStat label="يُلغى نهاية الفترة" value={w.subscription.cancelAtPeriodEnd ? "نعم" : "لا"} />
          </div>
        )}
      </SectionCard>

      <SectionCard title={`الأعضاء (${w.members.length})`} className="mt-4">
        <CardContent className="flex flex-col divide-y divide-border p-0">
          {w.members.map((m) => (
            <Link key={m.userId} href={`/platform-admin/users/${m.userId}`} className="flex items-center justify-between py-2.5 hover:text-brand">
              <span className="text-sm text-text-primary">{m.fullName}</span>
              <span className="flex items-center gap-2 text-xs text-text-tertiary">
                {m.roleLabel}
                <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status}</Badge>
              </span>
            </Link>
          ))}
        </CardContent>
      </SectionCard>

      <SectionCard title="الصلاحيات الحالية (Entitlements)" className="mt-4">
        {w.entitlements.length === 0 ? (
          <p className="text-sm text-text-secondary">لا توجد صلاحيات فعّالة حاليًا.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {w.entitlements.map((e) => (
              <Badge key={e.capability} tone={e.state === "ALLOWED" ? "success" : "danger"}>
                {e.capability}: {e.state === "ALLOWED" ? "مسموح" : "محظور"}
              </Badge>
            ))}
          </div>
        )}
      </SectionCard>
    </>
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
