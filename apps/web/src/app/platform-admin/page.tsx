"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, ErrorState, LoadingRegion, PermissionDeniedState, StatCard, formatDate } from "@academic-precision/ui";
import { PageHeader } from "../../components/shell/page-header";
import { qk } from "../../lib/query-keys";
import { fetchPlatformAdminDashboard } from "../../lib/api/platform-admin";
import { isForbidden } from "../../lib/api/client";

const STATE_LABEL: Record<string, string> = {
  TRIAL: "تجربة",
  ACTIVE: "نشط",
  EXPIRING: "قارب على الانتهاء",
  EXPIRED: "منتهٍ",
  PAYMENT_FAILED: "فشل الدفع",
  CANCELLED_AT_PERIOD_END: "سيُلغى نهاية الفترة",
};

export default function PlatformAdminDashboardPage() {
  const query = useQuery({
    queryKey: qk.platformAdmin.dashboard(),
    queryFn: fetchPlatformAdminDashboard,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (query.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (isForbidden(query.error)) return <PermissionDeniedState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const data = query.data;

  return (
    <>
      <PageHeader title="لوحة التحكم" description="أرقام حقيقية فقط — لا يوجد أي رقم إيراد مُخترع (لا عمود سعر في الاشتراكات بعد)." />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="إجمالي المستخدمين" value={String(data.totalUsers)} />
        <StatCard label="مساحات العمل" value={String(data.totalWorkspaces)} />
        <StatCard label="تنتهي خلال 7 أيام" value={String(data.expiringWithin7Days)} tone={data.expiringWithin7Days > 0 ? "warning" : undefined} />
        <StatCard label="آخر التسجيلات" value={String(data.recentSignups.length)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">الاشتراكات حسب الحالة</h2>
            <div className="flex flex-col divide-y divide-border">
              {Object.entries(data.subscriptionsByState).map(([state, count]) => (
                <div key={state} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-text-secondary">{STATE_LABEL[state] ?? state}</span>
                  <span className="font-medium tabular-nums text-text-primary">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">أحدث مساحات العمل</h2>
            <div className="flex flex-col divide-y divide-border">
              {data.recentSignups.map((w) => (
                <Link key={w.workspaceId} href={`/platform-admin/workspaces/${w.workspaceId}`} className="flex items-center justify-between py-2 text-sm hover:text-brand">
                  <div>
                    <p className="text-text-primary">{w.name}</p>
                    <p className="text-xs text-text-tertiary">{w.ownerName ?? "—"}</p>
                  </div>
                  <span className="text-xs text-text-tertiary">{formatDate(w.createdAt)}</span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
