"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, XCircle, Receipt, CreditCard, Sparkles, ArrowLeft, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  SectionCard,
  SegmentedControl,
  SkeletonRows,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  formatDate,
  formatMoney,
  formatRelativeToNow,
  type SemanticTone,
} from "@academic-precision/ui";
import {
  hasPlatformPermission,
  type BillingAttentionItem,
  type BillingAttentionSeverity,
  type LaunchReadinessItem,
  type PlatformBillingHistoryItem,
} from "@academic-precision/contracts";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { fetchPlatformBillingAttention, fetchPlatformBillingHistory, fetchPlatformBillingReadiness } from "../../../lib/api/platform-admin";
import { isForbidden } from "../../../lib/api/client";

const SEVERITY_TONE: Record<BillingAttentionSeverity, "danger" | "warning" | "neutral"> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};
const SEVERITY_LABEL: Record<BillingAttentionSeverity, string> = { HIGH: "عاجل", MEDIUM: "متوسط", LOW: "منخفض" };

const CAPACITY_ACTION_LABEL: Record<string, string> = {
  UPGRADE: "السياق: ترقية الباقة",
  REQUEST_CUSTOM: "السياق: عرض باقة مخصّصة",
  MODIFY_CUSTOM: "السياق: تعديل الباقة المخصّصة",
};

const HISTORY_CATEGORY_OPTIONS = [
  { value: "ALL", label: "الكل" },
  { value: "PAYMENT", label: "المدفوعات" },
  { value: "SUBSCRIPTION", label: "الاشتراكات" },
  { value: "CUSTOM", label: "المخصّصة" },
];

const READINESS_LABEL: Record<string, string> = {
  MIGRATIONS_CURRENT: "قاعدة البيانات محدَّثة",
  BILLING_TABLES_PRESENT: "جداول الفوترة موجودة",
  WORKER_HEALTHY: "خدمة المعالجة تعمل",
  NO_DEAD_OUTBOX: "لا رسائل معلَّقة فاشلة",
  PAYMENT_CHANNELS_CONFIGURED: "قنوات الدفع مُهيَّأة",
  CUSTOM_FLOWS_ENABLED: "مسارات الباقات المخصصة مفعَّلة",
};

export default function PlatformBillingCenterPage() {
  const { platformRole } = useWorkspace();
  const canView = hasPlatformPermission(platformRole, "platform.billing.view");

  const attention = useQuery({
    queryKey: ["platform-admin", "billing", "attention"],
    queryFn: fetchPlatformBillingAttention,
    enabled: canView,
    retry: (n, e) => !isForbidden(e) && n < 2,
  });

  const forbidden = isForbidden(attention.error) || !canView;

  return (
    <>
      <PageHeader
        title="مركز الفوترة"
        description="نقطة واحدة لمتابعة كل ما يخص الاشتراكات والمدفوعات: قائمة الأولويات، وجاهزية الإطلاق، والوصول السريع للشاشات التفصيلية."
      />

      <Tabs defaultValue="attention">
        <TabsList>
          <TabsTrigger value="attention">الأولويات</TabsTrigger>
          <TabsTrigger value="payments">المدفوعات</TabsTrigger>
          <TabsTrigger value="subscriptions">الاشتراكات</TabsTrigger>
          <TabsTrigger value="custom">الباقات المخصصة</TabsTrigger>
          <TabsTrigger value="history">السجل</TabsTrigger>
        </TabsList>

        <TabsContent value="attention">
          <div className="flex flex-col gap-6">
            <LaunchReadinessPanel enabled={canView} />

            <SectionCard title="ما يتطلّب انتباهًا" description="مرتَّبة حسب الأهمية ثم الأقدم انتظارًا.">
              {forbidden ? (
                <p className="text-sm text-text-secondary">لا تملك صلاحية عرض بيانات الفوترة.</p>
              ) : attention.isLoading ? (
                <SkeletonRows rows={5} />
              ) : attention.isError ? (
                <ErrorState onRetry={() => attention.refetch()} />
              ) : (attention.data?.items.length ?? 0) === 0 ? (
                <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="لا يوجد ما يتطلّب انتباهًا" />
              ) : (
                <ul className="flex flex-col gap-2">
                  {attention.data!.items.map((item) => (
                    <AttentionRow key={`${item.kind}-${item.entityId ?? item.workspaceId}-${item.since}`} item={item} />
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <ShortcutCard
            icon={<Receipt className="h-5 w-5" />}
            title="طلبات الدفع"
            description="مراجعة وتأكيد المدفوعات اليدوية (إنستاباي / فودافون كاش) وتفعيل الاشتراكات."
            href="/platform-admin/payment-requests"
          />
        </TabsContent>

        <TabsContent value="subscriptions">
          <ShortcutCard
            icon={<CreditCard className="h-5 w-5" />}
            title="الاشتراكات"
            description="عرض حالة اشتراكات مساحات العمل ودوراتها الشهرية."
            href="/platform-admin/subscriptions"
          />
        </TabsContent>

        <TabsContent value="custom">
          <ShortcutCard
            icon={<Sparkles className="h-5 w-5" />}
            title="الباقات المخصصة"
            description="طلبات وعروض الباقات المخصصة (أكثر من 3000 طالب)."
            href="/platform-admin/custom-plans"
          />
        </TabsContent>

        <TabsContent value="history">
          <PlatformBillingHistory enabled={canView && !forbidden} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function AttentionRow({ item }: { item: BillingAttentionItem }) {
  const tone = SEVERITY_TONE[item.severity];
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 shrink-0", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-text-tertiary")}>
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{SEVERITY_LABEL[item.severity]}</Badge>
            <span className="text-sm font-medium text-text-primary">{item.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
            <span>{item.workspaceName ?? "—"}</span>
            {item.kind === "CAPACITY_AT_LIMIT" ? (
              <>
                <span>·</span>
                <span>{item.currentPlan}</span>
                <span>·</span>
                <span>{CAPACITY_ACTION_LABEL[item.capacityAction ?? "UPGRADE"]}</span>
              </>
            ) : (
              <>
                <span>·</span>
                <span>{formatRelativeToNow(item.since)}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link href={`/platform-admin/${item.target}`}>
          فتح
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
      </Button>
    </li>
  );
}

function LaunchReadinessPanel({ enabled }: { enabled: boolean }) {
  const readiness = useQuery({
    queryKey: ["platform-admin", "billing", "readiness"],
    queryFn: fetchPlatformBillingReadiness,
    enabled,
    retry: (n, e) => !isForbidden(e) && n < 2,
  });

  if (!enabled || isForbidden(readiness.error)) return null;

  return (
    <SectionCard
      title="جاهزية الإطلاق"
      description="فحوصات تشغيلية لبدء تفعيل الفوترة."
      action={<ShieldCheck className="h-4 w-4 text-text-tertiary" aria-hidden />}
    >
      {readiness.isLoading ? (
        <SkeletonRows rows={4} />
      ) : readiness.isError ? (
        <ErrorState onRetry={() => readiness.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold",
              readiness.data!.ready
                ? "border-success/30 bg-success-subtle text-success"
                : "border-danger/30 bg-danger-subtle text-danger",
            )}
          >
            {readiness.data!.ready ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <XCircle className="h-5 w-5" aria-hidden />}
            {readiness.data!.ready ? "جاهز للإطلاق" : "غير جاهز"}
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {readiness.data!.checks.map((check) => (
              <ReadinessRow key={check.check} check={check} />
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function ReadinessRow({ check }: { check: LaunchReadinessItem }) {
  const tone: SemanticTone = check.ok ? "success" : "danger";
  return (
    <li className="flex items-start justify-between gap-4 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <StatusDot tone={tone} label={READINESS_LABEL[check.check] ?? check.check} />
        <span className="ps-3 text-xs text-text-tertiary">{check.detail}</span>
      </div>
      {check.ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
      ) : (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
      )}
    </li>
  );
}

function ShortcutCard({ icon, title, description, href }: { icon: React.ReactNode; title: string; description: string; href: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">{icon}</span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold text-text-primary">{title}</p>
            <p className="max-w-md text-xs text-text-secondary">{description}</p>
          </div>
        </div>
        <Button asChild className="shrink-0">
          <Link href={href}>
            فتح الشاشة
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function PlatformBillingHistory({ enabled }: { enabled: boolean }) {
  const [category, setCategory] = useState<string>("ALL");
  const query = useInfiniteQuery({
    queryKey: ["platform-admin", "billing", "history", category],
    queryFn: ({ pageParam }) =>
      fetchPlatformBillingHistory({ category: category === "ALL" ? undefined : category, cursor: pageParam as string | undefined, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.page.hasNext ? last.page.nextCursor ?? undefined : undefined),
    enabled,
    retry: (n, e) => !isForbidden(e) && n < 2,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <SectionCard
      title="سجل الفوترة"
      description="سجل زمني موحّد لأحداث الفوترة عبر العملاء — بيانات مُنسّقة، بلا ملاحظات داخلية أو توصيات."
      action={<SegmentedControl aria-label="التصنيف" options={HISTORY_CATEGORY_OPTIONS} value={category} onChange={setCategory} />}
    >
      {query.isLoading ? (
        <SkeletonRows rows={6} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="لا توجد أحداث فوترة" />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col divide-y divide-border">
            {items.map((it, i) => (
              <HistoryRow key={`${it.type}-${it.workspaceId}-${it.occurredAt}-${i}`} item={it} />
            ))}
          </ul>
          {query.hasNextPage ? (
            <Button variant="outline" size="sm" className="self-center" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
              عرض المزيد
            </Button>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}

function HistoryRow({ item }: { item: PlatformBillingHistoryItem }) {
  return (
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-text-primary">{item.title}</span>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-tertiary">
          <span>{item.workspaceName ?? "—"}</span>
          <span>·</span>
          <span>{formatDate(item.occurredAt)}</span>
          {item.reference ? (
            <>
              <span>·</span>
              <span className="font-mono">{item.reference}</span>
            </>
          ) : null}
        </div>
      </div>
      {item.amountMinor !== null ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">{formatMoney(item.amountMinor, item.currencyCode ?? "EGP")}</span>
      ) : null}
    </li>
  );
}
