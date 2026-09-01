"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingRegion,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  formatDate,
  formatMoney,
  toast,
} from "@academic-precision/ui";
import {
  STANDARD_PLANS,
  STANDARD_PLAN_LIST,
  isDowngrade,
  isStandardPlanCode,
  isUpgrade,
  type BillingCycle,
  type BillingPaymentMethod,
  type BillingPlanStateDto,
  type CreatePaymentRequestResponse,
  type UpgradeQuoteResponse,
} from "@academic-precision/contracts";
import {
  cancelDowngrade,
  createPaymentRequest,
  fetchBillingPlanState,
  quoteUpgrade,
  scheduleDowngrade,
} from "../../lib/api/billing";
import { PaymentInstructionsCard } from "./payment-request-panel";

const planName = (code: string | null): string => (code && isStandardPlanCode(code) ? STANDARD_PLANS[code].nameAr : (code ?? "—"));

const UPGRADE_REASON_AR: Record<string, string> = {
  FUTURE_PLAN_CHANGE_EXISTS: "يوجد تغيير باقة قادم (مجدول أو مدفوع). ألغِ الجدولة أو انتظر بدء الفترة القادمة قبل الترقية.",
  CROSS_CYCLE_UPGRADE_NOT_SUPPORTED: "تغيير دورة الفوترة أثناء الترقية غير متاح حاليًا.",
  UPGRADE_PRORATION_NON_POSITIVE: "لا يوجد فرق سعر مستحق على الوقت المتبقّي.",
  SUBSCRIPTION_NOT_ACTIVE: "الترقية متاحة فقط لاشتراك فعّال.",
  SAME_PLAN: "هذه باقتك الحالية.",
  NOT_AN_UPGRADE: "الباقة المطلوبة ليست ترقية.",
};
const upgradeReasonAr = (reason: string | null): string => (reason && UPGRADE_REASON_AR[reason]) || "الترقية غير متاحة لهذه الباقة الآن.";

/** Phase 4 — current plan + usage + upgrade (immediate, prorated) + scheduled downgrade. Owner-only (page is already owner-gated). */
export function PlanManagementPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const stateQuery = useQuery({ queryKey: ["billing", "plan-state", workspaceId], queryFn: () => fetchBillingPlanState(workspaceId) });

  if (stateQuery.isLoading) return <LoadingRegion />;
  if (stateQuery.isError || !stateQuery.data) return <ErrorState onRetry={() => stateQuery.refetch()} />;

  const ps = stateQuery.data.planState;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["billing", "plan-state", workspaceId] });
  const current = ps.currentPlanCode;
  const higher = current && isStandardPlanCode(current) ? STANDARD_PLAN_LIST.filter((p) => isUpgrade(current, p.code)) : [];
  const lower = current && isStandardPlanCode(current) ? STANDARD_PLAN_LIST.filter((p) => isDowngrade(current, p.code)) : [];

  return (
    <div className="flex flex-col gap-4">
      <PlanStateCard ps={ps} workspaceId={workspaceId} onChanged={invalidate} />
      {ps.state === "ACTIVE" && higher.length > 0 ? (
        <UpgradeCard workspaceId={workspaceId} ps={ps} higher={higher} onChanged={invalidate} />
      ) : null}
      {ps.state === "ACTIVE" && lower.length > 0 && !ps.pendingDowngrade ? (
        <DowngradeCard workspaceId={workspaceId} ps={ps} lower={lower} onChanged={invalidate} />
      ) : null}
    </div>
  );
}

function PlanStateCard({ ps, workspaceId, onChanged }: { ps: BillingPlanStateDto; workspaceId: string; onChanged: () => void }) {
  const cancelMutation = useMutation({
    mutationFn: () => cancelDowngrade(workspaceId),
    onSuccess: () => {
      toast.success("تم إلغاء خفض الباقة المجدول.");
      onChanged();
    },
    onError: () => toast.error("تعذّر إلغاء الجدولة."),
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-text-primary">باقتك الحالية</h3>
          <p className="mt-1 text-sm text-text-secondary">
            {planName(ps.currentPlanCode)}
            {ps.periodEnd ? <> • تتجدد في {formatDate(ps.periodEnd)}</> : null}
          </p>
        </div>
        <Badge tone="success">{planName(ps.currentPlanCode)}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <UsageStat label="الطلاب النشطون" used={ps.usage.activeStudents} limit={ps.limits.maxActiveStudents} />
        <UsageStat label="أعضاء الفريق" used={ps.usage.activeTeamMembers} limit={ps.limits.maxTeamMembers} />
      </div>

      {ps.pendingDowngrade ? (
        <div className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning-subtle/30 px-3 py-2 text-sm">
          <span className="text-text-secondary">
            مجدول: خفض إلى <span className="font-semibold text-text-primary">{planName(ps.pendingDowngrade.targetPlanCode)}</span> عند التجديد القادم — باقتك الحالية لا تتغيّر الآن.
          </span>
          <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
            إلغاء
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function UsageStat({ label, used, limit }: { label: string; used: number; limit: number }) {
  const over = used > limit;
  return (
    <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2">
      <span className="text-text-secondary">{label}</span>
      <p className={`mt-0.5 font-semibold ${over ? "text-danger" : "text-text-primary"}`}>
        {used} / {limit}
      </p>
    </div>
  );
}

function UpgradeCard({ workspaceId, ps, higher, onChanged }: { workspaceId: string; ps: BillingPlanStateDto; higher: typeof STANDARD_PLAN_LIST; onChanged: () => void }) {
  const cycle = (ps.billingCycle as BillingCycle) ?? "MONTHLY";
  const [target, setTarget] = useState<string>(higher[0]?.code ?? "");
  const [method, setMethod] = useState<BillingPaymentMethod>("INSTAPAY");
  const [quote, setQuote] = useState<UpgradeQuoteResponse | null>(null);
  const [created, setCreated] = useState<CreatePaymentRequestResponse | null>(null);

  const quoteMutation = useMutation({
    mutationFn: (targetPlanCode: string) => quoteUpgrade(workspaceId, { targetPlanCode: targetPlanCode as never, billingCycle: cycle }),
    onSuccess: (q) => setQuote(q),
    onError: () => toast.error("تعذّر حساب عرض الترقية."),
  });

  const createMutation = useMutation({
    mutationFn: () => createPaymentRequest(workspaceId, { planCode: target as never, billingCycle: cycle, paymentMethod: method }),
    onSuccess: (res) => {
      setCreated(res);
      onChanged();
    },
    onError: () => toast.error("تعذّر إنشاء طلب الترقية."),
  });

  const onSelectTarget = (code: string) => {
    setTarget(code);
    setQuote(null);
    setCreated(null);
    quoteMutation.mutate(code);
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary">ترقية الباقة</h3>
        <p className="mt-1 text-sm text-text-secondary">الترقية فورية بعد الدفع، وتدفع فقط فرق السعر عن الوقت المتبقّي.</p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-text-secondary">الباقة الأعلى</span>
        <Select value={target} onValueChange={onSelectTarget}>
          <SelectTrigger><SelectValue placeholder="اختر باقة أعلى" /></SelectTrigger>
          <SelectContent>
            {higher.map((p) => (
              <SelectItem key={p.code} value={p.code}>{p.nameAr} — حتى {p.maxActiveStudents} طالب</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {quoteMutation.isPending ? <LoadingRegion /> : null}

      {quote && quote.eligible ? (
        <div className="flex flex-col gap-2 rounded-lg border border-brand/30 bg-brand-subtle/20 p-4 text-sm">
          <Row label="الباقة الحالية" value={planName(quote.currentPlanCode)} />
          <Row label="الباقة المطلوبة" value={planName(quote.targetPlanCode)} />
          <Row label="السعر العادي للباقة الجديدة" value={formatMoney(quote.normalTargetPriceMinor, quote.currencyCode)} />
          <Row label="رصيد الوقت المتبقّي" value={`- ${formatMoney(quote.creditRemainingMinor, quote.currencyCode)}`} />
          <Row label="المستحق الآن" value={formatMoney(quote.amountDueMinor, quote.currencyCode)} strong />
          {quote.paidThrough ? <p className="text-xs text-text-tertiary">تاريخ انتهاء اشتراكك لا يتغيّر ({formatDate(quote.paidThrough)}).</p> : null}
        </div>
      ) : quote && !quote.eligible ? (
        <p className="text-sm text-danger">{upgradeReasonAr(quote.reason)}</p>
      ) : null}

      {quote && quote.eligible ? (
        <div className="flex items-center justify-between gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-text-secondary">طريقة الدفع</span>
            <Select value={method} onValueChange={(v) => setMethod(v as BillingPaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INSTAPAY">إنستاباي</SelectItem>
                <SelectItem value="VODAFONE_CASH">فودافون كاش</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button className="self-end" onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
            إنشاء طلب الترقية
          </Button>
        </div>
      ) : null}

      {created ? <PaymentInstructionsCard created={created} /> : null}
    </Card>
  );
}

function DowngradeCard({ workspaceId, ps, lower, onChanged }: { workspaceId: string; ps: BillingPlanStateDto; lower: typeof STANDARD_PLAN_LIST; onChanged: () => void }) {
  const [target, setTarget] = useState<string>(lower[lower.length - 1]?.code ?? "");
  const targetPlan = STANDARD_PLAN_LIST.find((p) => p.code === target);
  const studentsOver = targetPlan ? ps.usage.activeStudents > targetPlan.maxActiveStudents : false;
  const teamOver = targetPlan ? ps.usage.activeTeamMembers > targetPlan.maxTeamMembers : false;
  const blocked = studentsOver || teamOver;

  const scheduleMutation = useMutation({
    mutationFn: () => scheduleDowngrade(workspaceId, { targetPlanCode: target as never }),
    onSuccess: () => {
      toast.success("سيتم استخدام الباقة الجديدة عند التجديد القادم — باقتك الحالية لا تتغيّر الآن.");
      onChanged();
    },
    onError: () => toast.error("تعذّر جدولة خفض الباقة."),
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary">تغيير الباقة في التجديد القادم</h3>
        <p className="mt-1 text-sm text-text-secondary">خفض الباقة يُطبَّق عند التجديد القادم فقط، ولا يغيّر باقتك الحالية الآن.</p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-text-secondary">الباقة الأقل</span>
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger><SelectValue placeholder="اختر باقة أقل" /></SelectTrigger>
          <SelectContent>
            {lower.map((p) => (
              <SelectItem key={p.code} value={p.code}>{p.nameAr} — حتى {p.maxActiveStudents} طالب</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      {blocked && targetPlan ? (
        <div className="rounded-lg border border-danger/40 bg-danger-subtle/20 p-3 text-sm text-danger">
          استخدامك الحالي يتجاوز حدود الباقة المطلوبة:
          {studentsOver ? <div>• لديك {ps.usage.activeStudents} طالبًا نشطًا، وحدّ الباقة {targetPlan.maxActiveStudents}.</div> : null}
          {teamOver ? <div>• لديك {ps.usage.activeTeamMembers} من أعضاء الفريق، وحدّ الباقة {targetPlan.maxTeamMembers}.</div> : null}
          <div className="mt-1 text-text-secondary">قلّل الاستخدام قبل خفض الباقة.</div>
        </div>
      ) : null}

      <Button variant="secondary" className="self-start" disabled={blocked} onClick={() => scheduleMutation.mutate()} loading={scheduleMutation.isPending}>
        جدولة الخفض عند التجديد
      </Button>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      <span className={strong ? "font-semibold text-text-primary" : "text-text-primary"}>{value}</span>
    </div>
  );
}
