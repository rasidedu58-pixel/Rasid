"use client";

import Link from "next/link";
import { Card, CardContent, StatusDot, cn } from "@academic-precision/ui";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { PlatformServiceKey } from "@academic-precision/contracts";
import { usePlatformStatus } from "../../lib/use-platform-status";
import { PLATFORM_SERVICE_LABEL, SERVICE_STATUS_LABEL, serviceStatusTone } from "../../lib/platform-labels";

const CRITICAL: PlatformServiceKey[] = ["web", "api", "database"];

/**
 * Command-center widget — overall status + critical services + active-issue
 * count, linking to the full Issues page. Renders nothing for a caller without
 * platform.health.view (the query 403s).
 */
export function PlatformStatusWidget() {
  const { forbidden, services, overall, data } = usePlatformStatus();
  if (forbidden) return null;
  const activeCount = data?.activeIssues.length ?? 0;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <span className="flex items-center gap-2">
          <StatusDot tone={serviceStatusTone(overall)} label="" />
          <span className="text-sm font-semibold text-text-primary">حالة المنصة</span>
          <span className="text-sm text-text-secondary">{SERVICE_STATUS_LABEL[overall] ?? overall}</span>
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {CRITICAL.map((key) => (
            <span key={key} className="flex items-center gap-1.5 text-xs text-text-tertiary">
              <StatusDot tone={serviceStatusTone(services[key])} label="" />
              {PLATFORM_SERVICE_LABEL[key] ?? key}
            </span>
          ))}
        </span>
        {activeCount > 0 ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {activeCount} مشكلة نشطة
          </span>
        ) : null}
        <Link href="/platform-admin/issues" className="ms-auto flex items-center gap-1 text-sm text-brand hover:underline">
          عرض التفاصيل
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * Customer 360 notice — shown ONLY when the platform itself is DEGRADED/DOWN,
 * so a support agent knows a customer's problem may be platform-wide, not
 * account-specific. Renders nothing when healthy or when the caller lacks
 * platform.health.view.
 */
export function PlatformStatusNotice({ className }: { className?: string }) {
  const { forbidden, overall } = usePlatformStatus();
  if (forbidden) return null;
  if (overall !== "DEGRADED" && overall !== "DOWN") return null;

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3", className)}>
      <AlertTriangle className="h-5 w-5 shrink-0 text-warning" aria-hidden />
      <p className="text-sm text-text-primary">هناك مشكلة تشغيلية حالية في راصد قد تكون مرتبطة بما يواجهه العميل.</p>
      <Link href="/platform-admin/issues" className="ms-auto shrink-0 text-sm font-medium text-brand hover:underline">
        عرض حالة المنصة
      </Link>
    </div>
  );
}
