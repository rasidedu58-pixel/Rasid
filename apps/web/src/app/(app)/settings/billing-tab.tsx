"use client";

import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingRegion,
  Timeline,
  TimelineItem,
  formatDate,
  type SemanticTone,
} from "@academic-precision/ui";
import {
  STANDARD_PLANS,
  SUBSCRIPTION_STATUS_COPY,
  customOfferIsExpired,
  deriveDisplaySubscriptionStatus,
  effectivePaymentRequestStatus,
  formatEgpMinor,
  isStandardPlanCode,
  resolveBillingPrimaryAction,
  type BillingHistoryItem,
  type BillingPlanStateDto,
  type BillingPlanTier,
  type BillingPrimaryAction,
  type CapacityCtaTarget,
} from "@academic-precision/contracts";
import { useWorkspace } from "../../../lib/workspace-provider";
import {
  fetchBillingHistory,
  fetchBillingPlanState,
  fetchCustomState,
  listPaymentRequests,
} from "../../../lib/api/billing";
import { PaymentRequestPanel } from "../../../components/billing/payment-request-panel";
import { PlanManagementPanel } from "../../../components/billing/plan-management-panel";
import { CustomPlanPanel } from "../../../components/billing/custom-plan-panel";

const DAY_MS = 86_400_000;

/** Standard plan → Arabic name; CUSTOM → agreed-plan label; otherwise a dash. */
const planNameAr = (code: string | null): string =>
  code === "CUSTOM" ? "باقة مخصّصة" : code && isStandardPlanCode(code) ? STANDARD_PLANS[code].nameAr : "—";

const dayWord = (n: number): string => (n === 1 ? "يوم" : n === 2 ? "يومان" : n <= 10 ? "أيام" : "يومًا");

/** A billing-page sub-flow — the detailed forms still live in the existing panels. */
type BillingFlow = "PAYMENT" | "PLAN" | "CUSTOM";

const flowForCapacityTarget = (target: CapacityCtaTarget | undefined): BillingFlow =>
  target === "UPGRADE" ? "PLAN" : "CUSTOM";

function flowForAction(action: BillingPrimaryAction, capacityTarget?: CapacityCtaTarget): BillingFlow | null {
  switch (action) {
    case "CONTINUE_PAYMENT":
    case "RETRY_PAYMENT":
    case "RENEW":
    case "RENEW_SOON":
      return "PAYMENT";
    case "PAY_CUSTOM_OFFER":
    case "REVIEW_CUSTOM_OFFER":
      return "CUSTOM";
    case "REVIEW_SCHEDULED_DOWNGRADE":
      return "PLAN";
    case "AT_CAPACITY":
    case "NEAR_CAPACITY":
      return flowForCapacityTarget(capacityTarget);
    default:
      return null;
  }
}

const capacityCtaLabel = (target: CapacityCtaTarget | undefined): string =>
  target === "UPGRADE" ? "ترقية الباقة" : target === "REQUEST_CUSTOM" ? "طلب باقة مخصّصة" : "تعديل باقتك المخصّصة";

const capacityHint = (target: CapacityCtaTarget | undefined): string =>
  target === "UPGRADE" ? "رقِّ باقتك للحصول على سعة أكبر." : target === "REQUEST_CUSTOM" ? "اطلب باقة مخصّصة لسعة أكبر." : "عدّل باقتك المخصّصة لسعة أكبر.";

interface PrimaryActionCopy {
  title: string;
  description: string;
  ctaLabel: string;
  tone: SemanticTone;
}

function primaryActionCopy(action: BillingPrimaryAction, capacityTarget?: CapacityCtaTarget): PrimaryActionCopy | null {
  switch (action) {
    case "CONTINUE_PAYMENT":
      return { title: "أكمل عملية الدفع", description: "لديك طلب دفع قيد الانتظار — أكمل التحويل وأرسل الإثبات عبر واتساب.", ctaLabel: "متابعة الدفع", tone: "warning" };
    case "PAY_CUSTOM_OFFER":
      return { title: "ادفع لتفعيل باقتك المخصّصة", description: "قبلت العرض المخصّص — أكمل الدفع لتفعيل الباقة.", ctaLabel: "إتمام الدفع", tone: "brand" };
    case "RENEW":
      return { title: "جدّد اشتراكك", description: "انتهى وصولك إلى النظام — جدّد الآن لاستعادة الخدمة.", ctaLabel: "تجديد الآن", tone: "danger" };
    case "REVIEW_CUSTOM_OFFER":
      return { title: "راجع عرض باقتك المخصّصة", description: "وصلك عرض مخصّص — راجِعه لقبوله أو رفضه.", ctaLabel: "مراجعة العرض", tone: "brand" };
    case "RETRY_PAYMENT":
      return { title: "تعذّر إتمام الدفع الأخير", description: "لم يكتمل طلب الدفع الأخير — يمكنك إعادة المحاولة.", ctaLabel: "إعادة المحاولة", tone: "warning" };
    case "AT_CAPACITY":
      return { title: "بلغت الحد الأقصى", description: `لا يمكنك إضافة المزيد ضمن باقتك الحالية. ${capacityHint(capacityTarget)}`, ctaLabel: capacityCtaLabel(capacityTarget), tone: "danger" };
    case "RENEW_SOON":
      return { title: "اشتراكك يقترب من التجديد", description: "جدّد الآن لتجنّب انقطاع الخدمة.", ctaLabel: "تجديد الاشتراك", tone: "warning" };
    case "NEAR_CAPACITY":
      return { title: "تقترب من الحد الأقصى", description: `أنت قريب من حدود باقتك الحالية. ${capacityHint(capacityTarget)}`, ctaLabel: capacityCtaLabel(capacityTarget), tone: "warning" };
    case "REVIEW_SCHEDULED_DOWNGRADE":
      return { title: "لديك خفض باقة مجدول", description: "سيُطبَّق الخفض عند التجديد القادم — يمكنك إدارته أو إلغاؤه.", ctaLabel: "إدارة الجدولة", tone: "info" };
    default:
      return null;
  }
}

/**
 * §25 / Billing Phase 6 — the workspace owner's billing home, rebuilt into a
 * clear five-section information architecture (summary → usage → the ONE
 * primary action → pending commercial state → history) instead of four
 * competing phase cards. MONTHLY-only: no billing-cycle selectors anywhere.
 * The detailed upgrade/downgrade/custom/payment forms still come from the
 * existing panels, revealed UNDER the resolved primary action.
 */
export function BillingTab() {
  const { workspaceId, isOwner } = useWorkspace();
  const queryClient = useQueryClient();
  const [activeFlow, setActiveFlow] = useState<BillingFlow | null>(null);

  const planStateQuery = useQuery({
    queryKey: ["billing", "plan-state", workspaceId],
    queryFn: () => fetchBillingPlanState(workspaceId!),
    enabled: !!workspaceId && isOwner,
  });
  const customStateQuery = useQuery({
    queryKey: ["billing", "custom-state", workspaceId],
    queryFn: () => fetchCustomState(workspaceId!),
    enabled: !!workspaceId && isOwner,
  });
  const paymentRequestsQuery = useQuery({
    queryKey: ["billing", "payment-requests", workspaceId],
    queryFn: () => listPaymentRequests(workspaceId!),
    enabled: !!workspaceId && isOwner,
  });

  if (!isOwner) {
    return <Card className="p-6 text-center text-sm text-text-secondary">إدارة الاشتراك متاحة لمالك مساحة العمل فقط.</Card>;
  }

  if (planStateQuery.isLoading || customStateQuery.isLoading) return <LoadingRegion />;
  if (planStateQuery.isError || !planStateQuery.data || customStateQuery.isError || !customStateQuery.data) {
    return (
      <ErrorState
        onRetry={() => {
          planStateQuery.refetch();
          customStateQuery.refetch();
        }}
      />
    );
  }

  const ps = planStateQuery.data.planState;
  const cs = customStateQuery.data.customState;
  const latestPr = paymentRequestsQuery.data?.paymentRequests[0] ?? null;
  const nowMs = Date.now();

  // --- Derive the resolver inputs (plan-state + custom-state + latest payment request). ---
  const daysUntilPeriodEnd = ps.periodEnd ? Math.floor((new Date(ps.periodEnd).getTime() - nowMs) / DAY_MS) : null;
  const tier: BillingPlanTier =
    ps.currentPlanCode === "CUSTOM" ? "CUSTOM" : ps.currentPlanCode === "BUSINESS_PLUS" ? "BUSINESS_PLUS" : "STANDARD";

  const latestPrStatus = latestPr
    ? effectivePaymentRequestStatus({ status: latestPr.status, expiresAtMs: latestPr.expiresAt ? new Date(latestPr.expiresAt).getTime() : null, nowMs })
    : null;
  const hasPendingPaymentRequest = latestPrStatus === "PENDING";
  const hasFailedOrExpiredPaymentRequest = latestPrStatus === "REJECTED" || latestPrStatus === "EXPIRED";

  const offer = cs.offer;
  const hasAcceptedCustomOfferAwaitingPayment = !!offer && offer.status === "ACCEPTED";
  const hasPendingCustomOffer =
    !!offer &&
    offer.status === "PENDING_CUSTOMER" &&
    !customOfferIsExpired({ status: offer.status, validUntilMs: offer.validUntil ? new Date(offer.validUntil).getTime() : null, nowMs });
  const hasScheduledDowngrade = !!ps.pendingDowngrade;

  const primary = resolveBillingPrimaryAction({
    state: ps.state,
    hasPendingPaymentRequest,
    hasFailedOrExpiredPaymentRequest,
    hasAcceptedCustomOfferAwaitingPayment,
    hasPendingCustomOffer,
    hasScheduledDowngrade,
    capacityBand: ps.capacityBand,
    tier,
    hasFuturePaidPeriod: ps.hasFuturePaidPeriod,
    daysUntilPeriodEnd,
  });

  const displayStatus = deriveDisplaySubscriptionStatus({ state: ps.state, daysUntilPeriodEnd, hasFuturePaidPeriod: ps.hasFuturePaidPeriod });
  const statusCopy = SUBSCRIPTION_STATUS_COPY[displayStatus];

  const defaultFlow = flowForAction(primary.action, primary.capacityTarget);
  const effectiveFlow = activeFlow ?? defaultFlow;
  const copy = primaryActionCopy(primary.action, primary.capacityTarget);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["billing", "plan-state", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["billing", "custom-state", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["billing", "payment-requests", workspaceId] });
    queryClient.invalidateQueries({ queryKey: ["billing", "history", workspaceId] });
  };

  const customRelevant = cs.customCtaVisible || !!cs.request || !!cs.offer || tier === "CUSTOM";

  return (
    <div className="flex flex-col gap-4">
      {/* SECTION 1 — ملخّص الاشتراك */}
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">{planNameAr(ps.currentPlanCode)}</h3>
            <p className="mt-1 text-sm text-text-secondary">{priceLine(ps)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={statusCopy.tone}>{statusCopy.label}</Badge>
            <Button variant="ghost" size="sm" onClick={refresh}>
              تحديث
            </Button>
          </div>
        </div>

        {ps.periodEnd ? (
          <p className="text-sm text-text-secondary">
            {renewalLabel(displayStatus)} <span className="font-medium text-text-primary">{formatDate(ps.periodEnd)}</span>
          </p>
        ) : null}

        {ps.hasFuturePaidPeriod ? (
          <p className="w-fit rounded-md bg-success-subtle/30 px-2.5 py-1 text-xs text-success">مدفوع حتى فترة قادمة</p>
        ) : null}
      </Card>

      {/* SECTION 2 — الاستخدام */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="text-base font-semibold text-text-primary">الاستخدام</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UsageMeter label="الطلاب النشطون" used={ps.usage.activeStudents} limit={ps.limits.maxActiveStudents} />
          <UsageMeter label="أعضاء الفريق" used={ps.usage.activeTeamMembers} limit={ps.limits.maxTeamMembers} />
        </div>
        {ps.capacityBand === 100 ? (
          <p className="rounded-md border border-danger/40 bg-danger-subtle/20 px-3 py-2 text-sm text-danger">بلغت الحد الأقصى لباقتك الحالية.</p>
        ) : ps.capacityBand === 90 || ps.capacityBand === 95 ? (
          <p className="rounded-md border border-warning/40 bg-warning-subtle/25 px-3 py-2 text-sm text-warning">اقتراب الحد الأقصى — راجع خيارات التوسعة.</p>
        ) : null}
      </Card>

      {/* SECTION 3 — الإجراء (a single primary CTA; the resolver decides the headline) */}
      <Card className="flex flex-col gap-4 p-5">
        <h3 className="text-base font-semibold text-text-primary">الإجراء</h3>

        {copy ? (
          <div className={`flex flex-col gap-3 rounded-lg border p-4 ${bannerClass(copy.tone)}`}>
            <div>
              <p className="text-sm font-semibold text-text-primary">{copy.title}</p>
              <p className="mt-1 text-sm text-text-secondary">{copy.description}</p>
            </div>
            <Button
              className="self-start"
              variant={copy.tone === "danger" ? "danger" : "primary"}
              onClick={() => setActiveFlow(flowForAction(primary.action, primary.capacityTarget))}
            >
              {copy.ctaLabel}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">اشتراكك مُدار ولا يتطلّب أي إجراء الآن. يمكنك مراجعة خيارات باقتك أدناه.</p>
        )}

        {/* Secondary navigation — reachable, but never a competing headline. */}
        <div className="flex flex-wrap gap-2">
          <FlowChip active={effectiveFlow === "PLAN"} onClick={() => setActiveFlow("PLAN")}>
            إدارة الباقة
          </FlowChip>
          {customRelevant ? (
            <FlowChip active={effectiveFlow === "CUSTOM"} onClick={() => setActiveFlow("CUSTOM")}>
              الباقة المخصّصة
            </FlowChip>
          ) : null}
          <FlowChip active={effectiveFlow === "PAYMENT"} onClick={() => setActiveFlow("PAYMENT")}>
            الدفع والتجديد
          </FlowChip>
        </div>

        {/* Exactly one detailed sub-flow shows at a time. */}
        {effectiveFlow === "PLAN" ? <PlanManagementPanel workspaceId={workspaceId!} /> : null}
        {effectiveFlow === "CUSTOM" ? <CustomPlanPanel workspaceId={workspaceId!} /> : null}
        {effectiveFlow === "PAYMENT" ? <PaymentRequestPanel workspaceId={workspaceId!} /> : null}
      </Card>

      {/* SECTION 4 — حالات قيد التنفيذ */}
      <PendingStateSection
        hasPendingPaymentRequest={hasPendingPaymentRequest}
        pendingPaymentLabel={latestPr ? `طلب دفع قيد الانتظار — ${latestPr.humanCode} • ${formatEgpMinor(latestPr.amountMinor)}` : null}
        scheduledDowngrade={ps.pendingDowngrade ? planNameAr(ps.pendingDowngrade.targetPlanCode) : null}
        acceptedOffer={hasAcceptedCustomOfferAwaitingPayment && offer ? formatEgpMinor(offer.priceMinor) : null}
        pendingOffer={hasPendingCustomOffer}
        hasFuturePaidPeriod={ps.hasFuturePaidPeriod}
      />

      {/* SECTION 5 — سجل الفوترة */}
      <BillingHistorySection workspaceId={workspaceId!} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function priceLine(ps: BillingPlanStateDto): string {
  if (ps.state === "TRIAL") {
    const d = ps.trialDaysRemaining;
    return d != null ? `فترة تجريبية — متبقٍّ ${d} ${dayWord(d)}` : "فترة تجريبية";
  }
  if (ps.currentPriceMinor != null) return `${formatEgpMinor(ps.currentPriceMinor)} / شهريًا`;
  return "—";
}

function renewalLabel(status: string): string {
  if (status === "EXPIRED") return "انتهى في";
  if (status === "EXPIRING" || status === "CANCELLED_AT_PERIOD_END") return "ينتهي في";
  return "يتجدد في";
}

function bannerClass(tone: SemanticTone): string {
  switch (tone) {
    case "danger":
      return "border-danger/40 bg-danger-subtle/15";
    case "warning":
      return "border-warning/40 bg-warning-subtle/20";
    case "brand":
      return "border-brand/30 bg-brand-subtle/20";
    case "info":
      return "border-info/40 bg-info-subtle/20";
    default:
      return "border-border bg-surface-sunken";
  }
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = used > limit;
  const barTone = over || pct >= 100 ? "bg-danger" : pct >= 90 ? "bg-warning" : "bg-brand";
  return (
    <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className={`font-semibold ${over ? "text-danger" : "text-text-primary"}`}>
          {used} / {limit}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} aria-hidden />
      </div>
    </div>
  );
}

function FlowChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active ? "border-brand bg-brand-subtle/30 font-medium text-brand" : "border-border text-text-secondary hover:bg-surface-sunken"
      }`}
    >
      {children}
    </button>
  );
}

function PendingStateSection({
  hasPendingPaymentRequest,
  pendingPaymentLabel,
  scheduledDowngrade,
  acceptedOffer,
  pendingOffer,
  hasFuturePaidPeriod,
}: {
  hasPendingPaymentRequest: boolean;
  pendingPaymentLabel: string | null;
  scheduledDowngrade: string | null;
  acceptedOffer: string | null;
  pendingOffer: boolean;
  hasFuturePaidPeriod: boolean;
}) {
  const items: Array<{ tone: SemanticTone; label: string }> = [];
  if (hasPendingPaymentRequest && pendingPaymentLabel) items.push({ tone: "warning", label: pendingPaymentLabel });
  if (acceptedOffer) items.push({ tone: "brand", label: `عرض مخصّص مقبول بانتظار الدفع — ${acceptedOffer}` });
  if (pendingOffer) items.push({ tone: "brand", label: "عرض مخصّص بانتظار مراجعتك" });
  if (scheduledDowngrade) items.push({ tone: "info", label: `خفض مجدول إلى «${scheduledDowngrade}» عند التجديد القادم` });
  if (hasFuturePaidPeriod) items.push({ tone: "success", label: "فترة مدفوعة قادمة تغطّي ما بعد التجديد الحالي" });

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h3 className="text-base font-semibold text-text-primary">حالات قيد التنفيذ</h3>
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary">لا توجد إجراءات قيد التنفيذ حاليًا.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm">
              <Badge tone={it.tone}>•</Badge>
              <span className="text-text-secondary">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const HISTORY_TONE: Record<BillingHistoryItem["type"], SemanticTone> = {
  PAYMENT_REQUEST_CREATED: "warning",
  PAYMENT_CONFIRMED: "success",
  PAYMENT_REJECTED: "danger",
  PAYMENT_REVERSED: "danger",
  PLAN_UPGRADED: "brand",
  DOWNGRADE_SCHEDULED: "info",
  CUSTOM_OFFER_ACCEPTED: "brand",
  CUSTOM_APPLIED: "success",
  RENEWAL: "success",
};

function BillingHistorySection({ workspaceId }: { workspaceId: string }) {
  const query = useInfiniteQuery({
    queryKey: ["billing", "history", workspaceId],
    queryFn: ({ pageParam }) => fetchBillingHistory(workspaceId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasNext ? last.page.nextCursor : null),
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card className="flex flex-col gap-4 p-5">
      <h3 className="text-base font-semibold text-text-primary">سجل الفوترة</h3>

      {query.isLoading ? (
        <LoadingRegion />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-sm text-text-secondary">لا يوجد سجل فوترة بعد.</p>
      ) : (
        <>
          <Timeline>
            {items.map((it, i) => (
              <TimelineItem
                key={`${it.type}-${it.occurredAt}-${i}`}
                tone={HISTORY_TONE[it.type]}
                date={formatDate(it.occurredAt)}
                title={it.title}
                context={historyContext(it)}
                last={i === items.length - 1}
              />
            ))}
          </Timeline>

          {query.hasNextPage ? (
            <Button variant="ghost" size="sm" className="self-center" onClick={() => query.fetchNextPage()} loading={query.isFetchingNextPage}>
              عرض المزيد
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}

function historyContext(it: BillingHistoryItem): string | undefined {
  const parts: string[] = [];
  if (it.amountMinor != null) parts.push(formatEgpMinor(it.amountMinor));
  if (it.reference) parts.push(`مرجع: ${it.reference}`);
  return parts.length > 0 ? parts.join(" • ") : undefined;
}
