"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  ErrorState,
  LoadingRegion,
  PermissionDeniedState,
  SectionCard,
  StatCard,
  StatusDot,
  cn,
  formatDate,
  formatDateTime,
} from "@academic-precision/ui";
import { AlertTriangle, ArrowLeft, CalendarClock, CreditCard } from "lucide-react";
import { PageHeader } from "../../components/shell/page-header";
import { PlatformSearch } from "../../components/platform-admin/platform-search";
import { qk } from "../../lib/query-keys";
import {
  fetchPlatformActivity,
  fetchPlatformAdminDashboard,
  fetchPlatformNeedsAttention,
} from "../../lib/api/platform-admin";
import { fetchApiHealth } from "../../lib/api/health";
import { isForbidden } from "../../lib/api/client";
import { SUB_STATE_LABEL, subStateTone } from "../../lib/platform-labels";
import { useWorkspace } from "../../lib/workspace-provider";
import { hasPlatformPermission, type PlatformNeedsAttentionResponse } from "@academic-precision/contracts";

export default function PlatformCommandCenterPage() {
  const { platformRole } = useWorkspace();
  const canViewSubs = hasPlatformPermission(platformRole, "platform.subscriptions.view");
  const dashboard = useQuery({
    queryKey: qk.platformAdmin.dashboard(),
    queryFn: fetchPlatformAdminDashboard,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });
  const attention = useQuery({
    queryKey: qk.platformAdmin.needsAttention(),
    queryFn: fetchPlatformNeedsAttention,
    enabled: canViewSubs,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });
  const activity = useQuery({
    queryKey: qk.platformAdmin.activity(),
    queryFn: fetchPlatformActivity,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (dashboard.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (isForbidden(dashboard.error)) return <PermissionDeniedState />;
  if (dashboard.isError || !dashboard.data) return <ErrorState onRetry={() => dashboard.refetch()} />;

  const data = dashboard.data;
  const attn = attention.data;
  const attnTotal = attn ? attn.trialsExpiringSoon.length + attn.expired.length + attn.paymentFailed.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="مركز تشغيل راصد" description="نظرة تشغيلية واحدة: صحة المنصة، ما يحتاج تدخلًا، والعملاء." />

      <PlatformSearch />

      <PlatformHealthCard />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="المستخدمون" value={String(data.totalUsers)} />
        <StatCard label="مساحات العمل" value={String(data.totalWorkspaces)} />
        {canViewSubs ? <StatCard label="تنتهي خلال 7 أيام" value={String(data.expiringWithin7Days)} tone={data.expiringWithin7Days > 0 ? "warning" : undefined} /> : null}
        {canViewSubs ? <StatCard label="يحتاج تدخلًا" value={String(attnTotal)} tone={attnTotal > 0 ? "danger" : undefined} /> : null}
      </div>

      {/* Needs attention — subscription-derived, only for platform.subscriptions.view */}
      {canViewSubs ? (
      <SectionCard
        title="يحتاج تدخلًا"
        description="حالات تشغيلية قابلة للرصد من بيانات الاشتراكات — لا تنبيهات وهمية."
      >
        {attention.isLoading ? (
          <p className="text-sm text-text-tertiary">جارٍ التحميل…</p>
        ) : attn && attnTotal > 0 ? (
          <div className="flex flex-col gap-4">
            <AttentionGroup icon={<CalendarClock className="h-4 w-4 text-warning" aria-hidden />} title="تجارب تنتهي قريبًا" tone="warning" items={attn.trialsExpiringSoon} showDays />
            <AttentionGroup icon={<AlertTriangle className="h-4 w-4 text-danger" aria-hidden />} title="اشتراكات منتهية" tone="danger" items={attn.expired} />
            <AttentionGroup icon={<CreditCard className="h-4 w-4 text-danger" aria-hidden />} title="فشل دفع" tone="danger" items={attn.paymentFailed} />
          </div>
        ) : (
          <p className="text-sm text-text-secondary">لا يوجد ما يحتاج تدخلًا الآن.</p>
        )}
      </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Subscriptions by state — only for platform.subscriptions.view */}
        {canViewSubs ? (
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">الاشتراكات حسب الحالة</h2>
            <div className="flex flex-col divide-y divide-border">
              {Object.entries(data.subscriptionsByState).length === 0 ? (
                <p className="py-2 text-sm text-text-tertiary">لا اشتراكات بعد.</p>
              ) : (
                Object.entries(data.subscriptionsByState).map(([state, count]) => (
                  <Link
                    key={state}
                    href={`/platform-admin/subscriptions?state=${state}`}
                    className="flex items-center justify-between py-2 text-sm hover:text-brand"
                  >
                    <span className="flex items-center gap-2">
                      <StatusDot tone={subStateTone(state)} label="" />
                      <span className="text-text-secondary">{SUB_STATE_LABEL[state] ?? state}</span>
                    </span>
                    <span className="font-medium tabular-nums text-text-primary">{count}</span>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        ) : null}

        {/* Recent activity */}
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-text-primary">نشاط حديث</h2>
            {activity.isLoading ? (
              <p className="text-sm text-text-tertiary">جارٍ التحميل…</p>
            ) : activity.data && activity.data.items.length > 0 ? (
              <ul className="flex flex-col divide-y divide-border">
                {activity.data.items.slice(0, 12).map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusDot tone={a.kind === "workspace.created" ? "success" : "warning"} label="" />
                      {a.workspaceId ? (
                        <Link href={`/platform-admin/workspaces/${a.workspaceId}`} className="truncate text-text-primary hover:text-brand">
                          {a.workspaceName ?? "—"}
                        </Link>
                      ) : (
                        <span className="truncate text-text-primary">{a.workspaceName ?? "—"}</span>
                      )}
                      <span className="shrink-0 text-xs text-text-tertiary">
                        {a.label}
                        {a.detail ? ` · ${SUB_STATE_LABEL[a.detail] ?? a.detail}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-text-tertiary">{formatDateTime(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-tertiary">لا نشاط حديث.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent signups */}
      <SectionCard title="أحدث التسجيلات">
        {data.recentSignups.length === 0 ? (
          <p className="text-sm text-text-tertiary">لا تسجيلات بعد.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.recentSignups.map((w) => (
              <li key={w.workspaceId}>
                <Link href={`/platform-admin/workspaces/${w.workspaceId}`} className="flex items-center justify-between py-2.5 text-sm hover:bg-surface-sunken">
                  <span className="flex flex-col">
                    <span className="font-medium text-text-primary">{w.name}</span>
                    <span className="text-xs text-text-tertiary">{w.ownerName ?? "—"}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-text-tertiary">
                    {formatDate(w.createdAt)}
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function AttentionGroup({
  icon,
  title,
  tone,
  items,
  showDays,
}: {
  icon: React.ReactNode;
  title: string;
  tone: "warning" | "danger";
  items: PlatformNeedsAttentionResponse["trialsExpiringSoon"];
  showDays?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-text-secondary">
        {icon}
        {title}
        <span className="text-text-tertiary">({items.length})</span>
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {items.map((it) => (
          <li key={it.workspaceId}>
            <Link href={`/platform-admin/workspaces/${it.workspaceId}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-sunken">
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-text-primary">{it.workspaceName}</span>
                <span className="truncate text-xs text-text-tertiary">{it.ownerName ?? "—"}</span>
              </span>
              <span className={cn("shrink-0 text-xs font-medium", tone === "danger" ? "text-danger" : "text-warning")}>
                {showDays && it.daysLeft !== null ? `${it.daysLeft} يوم` : SUB_STATE_LABEL[it.state] ?? it.state}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlatformHealthCard() {
  const health = useQuery({
    queryKey: qk.platformAdmin.health(),
    queryFn: fetchApiHealth,
    refetchInterval: 30_000,
  });
  const api = health.data?.api ?? (health.isLoading ? "unknown" : "down");
  const db = health.data?.database ?? "unknown";
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <span className="text-sm font-semibold text-text-primary">حالة المنصة</span>
        <HealthPill label="واجهة البرمجة (API)" status={api} />
        <HealthPill label="قاعدة البيانات" status={db} />
        <span className="ms-auto text-xs text-text-tertiary">
          المراقبة الخارجية (Sentry/Uptime) تُدار خارج هذه اللوحة.
        </span>
      </CardContent>
    </Card>
  );
}

function HealthPill({ label, status }: { label: string; status: "up" | "down" | "unknown" }) {
  const tone = status === "up" ? "success" : status === "down" ? "danger" : "neutral";
  const text = status === "up" ? "تعمل" : status === "down" ? "متوقفة" : "—";
  return (
    <span className="flex items-center gap-2 text-sm">
      <StatusDot tone={tone} label="" />
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text-primary">{text}</span>
    </span>
  );
}
