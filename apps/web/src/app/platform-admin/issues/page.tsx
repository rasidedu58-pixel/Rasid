"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Card,
  CardContent,
  LoadingRegion,
  PermissionDeniedState,
  SectionCard,
  StatusDot,
  cn,
  formatDateTime,
} from "@academic-precision/ui";
import { RefreshCw } from "lucide-react";
import type { PlatformServiceKey, ServiceStatus } from "@academic-precision/contracts";
import { PageHeader } from "../../../components/shell/page-header";
import { qk } from "../../../lib/query-keys";
import { usePlatformStatus } from "../../../lib/use-platform-status";
import { useWorkspace } from "../../../lib/workspace-provider";
import { hasPlatformPermission } from "@academic-precision/contracts";
import {
  ISSUE_SEVERITY_LABEL,
  PLATFORM_SERVICE_LABEL,
  SERVICE_STATUS_LABEL,
  issueSeverityTone,
  serviceStatusTone,
} from "../../../lib/platform-labels";

const SERVICE_ORDER: PlatformServiceKey[] = ["web", "api", "database", "worker"];

export default function PlatformIssuesPage() {
  const { platformRole } = useWorkspace();
  const canSeeDetails = hasPlatformPermission(platformRole, "platform.health.details");
  const queryClient = useQueryClient();
  const { query, forbidden, services, overall, data, updatedAt } = usePlatformStatus();

  if (forbidden) return <PermissionDeniedState />;
  if (query.isLoading && !data) return <LoadingRegion className="min-h-[60vh]" />;

  const activeIssues = data?.activeIssues ?? [];
  const recentProblems = data?.recentProblems ?? [];
  const jobs = data?.jobs ?? null;
  // "Enough data" to declare all-clear = we could actually reach the API.
  const haveEnough = services.api !== "UNKNOWN";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="حالة المنصة والمشكلات"
        description="نظرة تشغيلية فورية: هل راصد يعمل؟ وما الذي تأثر؟"
        actions={
          <button
            type="button"
            onClick={() => queryClient.invalidateQueries({ queryKey: qk.platformAdmin.status() })}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-sunken"
          >
            <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} aria-hidden />
            تحديث الآن
          </button>
        }
      />

      {/* Overall + services */}
      <Card>
        <CardContent className="flex flex-col gap-5 p-5">
          <div className="flex items-center gap-3">
            <StatusDot tone={serviceStatusTone(overall)} label="" />
            <div className="flex flex-col">
              <span className="text-xs text-text-tertiary">راصد — الحالة العامة</span>
              <span className="text-lg font-semibold text-text-primary">{SERVICE_STATUS_LABEL[overall] ?? overall}</span>
            </div>
            <span className="ms-auto text-xs text-text-tertiary">
              {updatedAt ? `آخر تحديث: ${formatDateTime(new Date(updatedAt).toISOString())}` : null}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SERVICE_ORDER.map((key) => (
              <ServiceTile key={key} name={PLATFORM_SERVICE_LABEL[key] ?? key} status={services[key]} />
            ))}
          </div>
          {data?.workerSource === "unavailable" ? (
            <p className="text-xs text-text-tertiary">
              حالة المعالج الخلفي تتطلب تفعيل قراءة قائمة المهام (migration 0057) — تظهر «غير معروفة» حتى تُطبَّق.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Active issues */}
      <SectionCard title="مشكلات نشطة" description="مشتقّة من مصادر الحالة الحيّة — بلا تنبيهات وهمية.">
        {activeIssues.length > 0 ? (
          <div className="flex flex-col gap-3">
            {activeIssues.map((issue) => (
              <div key={issue.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Badge tone={issueSeverityTone(issue.severity)}>{ISSUE_SEVERITY_LABEL[issue.severity] ?? issue.severity}</Badge>
                  <span className="text-sm font-semibold text-text-primary">{issue.title}</span>
                  <span className="ms-auto text-xs text-text-tertiary">{issue.affectedPart}</span>
                </div>
                <p className="text-sm text-text-secondary">{issue.description}</p>
                <div className="flex items-center gap-3 text-xs text-text-tertiary">
                  {issue.startedAt ? <span>بدأت: {formatDateTime(issue.startedAt)}</span> : null}
                  {issue.lastSeenAt ? <span>آخر ظهور: {formatDateTime(issue.lastSeenAt)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : haveEnough ? (
          <p className="text-sm text-text-secondary">لا توجد مشكلات تشغيلية نشطة تم رصدها.</p>
        ) : (
          <p className="text-sm text-text-tertiary">لا تتوفر بيانات كافية لتحديد الحالة.</p>
        )}
      </SectionCard>

      {/* Details — only for platform.health.details (worker jobs + recent problems) */}
      {canSeeDetails ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-text-primary">المهام الخلفية</h2>
              {jobs ? (
                <div className="grid grid-cols-3 gap-3">
                  <JobStat label="قيد الانتظار" value={jobs.pending} />
                  <JobStat label="إعادة المحاولة" value={jobs.retrying} tone={jobs.retrying > 0 ? "warning" : undefined} />
                  <JobStat label="فشل نهائي" value={jobs.dead} tone={jobs.dead > 0 ? "danger" : undefined} />
                </div>
              ) : (
                <p className="text-sm text-text-tertiary">غير متاحة (تتطلب migration 0057).</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-text-primary">مشكلات حديثة</h2>
              {recentProblems.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border">
                  {recentProblems.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <StatusDot tone={p.resolved ? "success" : "warning"} label="" />
                        <span className="truncate text-text-primary">{p.part}</span>
                        <span className="shrink-0 text-xs text-text-tertiary">{p.summary}</span>
                      </span>
                      <span className="shrink-0 text-xs text-text-tertiary">{formatDateTime(p.at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-tertiary">لا توجد مشكلات حديثة مسجّلة.</p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ServiceTile({ name, status }: { name: string; status: ServiceStatus }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <span className="text-xs text-text-tertiary">{name}</span>
      <span className="flex items-center gap-2">
        <StatusDot tone={serviceStatusTone(status)} label="" />
        <span className="text-sm font-medium text-text-primary">{SERVICE_STATUS_LABEL[status] ?? status}</span>
      </span>
    </div>
  );
}

function JobStat({ label, value, tone }: { label: string; value: number; tone?: "warning" | "danger" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className={cn("text-xl font-semibold tabular-nums", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-text-primary")}>
        {value}
      </span>
    </div>
  );
}
