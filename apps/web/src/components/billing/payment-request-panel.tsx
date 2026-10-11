"use client";

import { useEffect, useState } from "react";
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
  formatMoney,
  toast,
} from "@academic-precision/ui";
import {
  STANDARD_PLAN_LIST,
  type BillingCycle,
  type BillingPaymentMethod,
  type PaymentInstructions,
  type PaymentRequestDto,
} from "@academic-precision/contracts";
import { createPaymentRequest, listPaymentRequests } from "../../lib/api/billing";

const STATUS_TONE: Record<PaymentRequestDto["status"], "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};
/**
 * Wording rule for this screen: there is NO payment gateway in V1. Nothing
 * here may read as "paid" — the user transfers money themselves and an
 * administrator verifies it. So: «وسيلة التحويل» not «طريقة الدفع»,
 * «بانتظار مراجعة الدفع» not «بانتظار التأكيد», «أرسل إثبات التحويل».
 */
const STATUS_LABEL: Record<PaymentRequestDto["status"], string> = {
  PENDING: "بانتظار مراجعة الدفع",
  CONFIRMED: "تمت المراجعة — الاشتراك مُفعَّل",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
  EXPIRED: "منتهي",
};
const METHOD_LABEL: Record<BillingPaymentMethod, string> = { INSTAPAY: "إنستاباي", VODAFONE_CASH: "فودافون كاش" };
const CYCLE_LABEL: Record<BillingCycle, string> = { MONTHLY: "شهري", ANNUAL: "سنوي" };
const PLAN_LABEL = (code: string) => STANDARD_PLAN_LIST.find((p) => p.code === code)?.nameAr ?? code;

/** Manual transfer flow (Billing Phase 3): pick plan + transfer channel → create a request → transfer and send proof → an administrator reviews it. */
export function PaymentRequestPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [planCode, setPlanCode] = useState<string>("PROFESSIONAL");
  const [method, setMethod] = useState<BillingPaymentMethod | null>(null);
  const [created, setCreated] = useState<{ paymentRequest: PaymentRequestDto; instructions: PaymentInstructions } | null>(null);

  const listQuery = useQuery({
    queryKey: ["billing", "payment-requests", workspaceId],
    queryFn: () => listPaymentRequests(workspaceId),
  });

  const createMutation = useMutation({
    mutationFn: () => createPaymentRequest(workspaceId, { planCode: planCode as never, billingCycle: "MONTHLY", paymentMethod: method! }),
    onSuccess: (res) => {
      setCreated(res);
      queryClient.invalidateQueries({ queryKey: ["billing", "payment-requests", workspaceId] });
    },
    onError: () => toast.error("تعذّر إنشاء طلب الدفع"),
  });

  const selectedPlan = STANDARD_PLAN_LIST.find((p) => p.code === planCode);
  const priceMinor = selectedPlan ? selectedPlan.monthlyPriceMinor : 0; // MONTHLY-only
  const latest = listQuery.data?.paymentRequests[0];

  // Channel availability comes from the server. An older API omits it, in
  // which case every method is offered exactly as before (rolling-deploy safe).
  const channels = listQuery.data?.channels;
  const isAvailable = (m: BillingPaymentMethod) => (channels ? (channels.find((c) => c.method === m)?.available ?? false) : true);
  const availableMethods = (["INSTAPAY", "VODAFONE_CASH"] as const).filter(isAvailable);
  const noChannelConfigured = channels !== undefined && availableMethods.length === 0;

  // Default to the first channel that can actually receive money, and never
  // leave a disabled one selected.
  useEffect(() => {
    if (method && isAvailable(method)) return;
    setMethod(availableMethods[0] ?? null);
    // Intentionally keyed on `channels` alone: this runs when the server's
    // availability answer arrives (or changes), never on every render that
    // happens to recompute the derived arrays.
  }, [channels]);

  // A pending request keeps its instructions across reloads (server-rebuilt),
  // so the amount / handle / reference never disappear on refresh.
  const pendingInstructions = listQuery.data?.pendingInstructions ?? null;
  const latestIsPending = latest?.status === "PENDING";
  const shownInstructions = created
    ? created.instructions
    : latestIsPending && pendingInstructions
      ? pendingInstructions
      : null;
  const shownRequest = created ? created.paymentRequest : latestIsPending ? latest : null;

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary">الاشتراك المدفوع</h3>
        <p className="mt-1 text-sm text-text-secondary">
          الدفع تحويل يدوي: اختر الباقة ووسيلة التحويل، حوّل المبلغ، ثم أرسل إثبات التحويل — ويُفعَّل الاشتراك بعد مراجعة الإدارة.
        </p>
      </div>

      {/* Latest request status */}
      {listQuery.isLoading ? (
        <LoadingRegion />
      ) : listQuery.isError ? (
        <ErrorState onRetry={() => listQuery.refetch()} />
      ) : latest ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm">
          <span className="text-text-secondary">
            آخر طلب: {latest.humanCode} • {formatMoney(latest.amountMinor, latest.currencyCode)}
          </span>
          <Badge tone={STATUS_TONE[latest.status]}>{STATUS_LABEL[latest.status]}</Badge>
        </div>
      ) : null}

      {/* Selection — MONTHLY-only (no cycle selector) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">الباقة</span>
          <Select value={planCode} onValueChange={setPlanCode}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STANDARD_PLAN_LIST.map((p) => (
                <SelectItem key={p.code} value={p.code}>{p.nameAr} — حتى {p.maxActiveStudents} طالب</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">وسيلة التحويل</span>
          <Select value={method ?? ""} onValueChange={(v) => setMethod(v as BillingPaymentMethod)} disabled={noChannelConfigured}>
            <SelectTrigger><SelectValue placeholder="اختر وسيلة التحويل" /></SelectTrigger>
            <SelectContent>
              {(["INSTAPAY", "VODAFONE_CASH"] as const).map((m) => (
                // A channel with no configured handle is shown DISABLED with
                // the reason, never as a working option that fails afterwards.
                <SelectItem key={m} value={m} disabled={!isAvailable(m)}>
                  {METHOD_LABEL[m]}
                  {isAvailable(m) ? "" : " — غير متاحة حاليًا"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {noChannelConfigured ? (
        <p className="rounded-lg border border-warning/30 bg-warning-subtle/30 px-3 py-2.5 text-sm leading-relaxed text-text-secondary">
          لا توجد وسيلة تحويل مُفعَّلة على الخادم حاليًا، فلا يمكن إنشاء طلب دفع. تواصل مع الدعم لتفعيلها.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-text-secondary">
          المبلغ: <span className="font-semibold text-text-primary">{formatMoney(priceMinor)}</span> / شهريًا
        </span>
        <Button
          className="w-full justify-center sm:w-auto"
          onClick={() => createMutation.mutate()}
          loading={createMutation.isPending}
          disabled={!method || noChannelConfigured}
        >
          إنشاء طلب الدفع
        </Button>
      </div>

      {/* Instructions for the request currently awaiting review — from the
          create response, or rebuilt by the server after a reload. */}
      {shownInstructions && shownRequest ? (
        <PaymentInstructionsCard instructions={shownInstructions} request={shownRequest} />
      ) : null}
    </Card>
  );
}

export function PaymentInstructionsCard({
  instructions: ins,
  request: req,
}: {
  instructions: PaymentInstructions;
  request: PaymentRequestDto;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand-subtle/30 p-4">
      <div>
        <p className="text-sm font-semibold text-text-primary">خطوات إتمام التحويل</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          الطلب مُسجَّل الآن <span className="font-medium">بانتظار مراجعة الدفع</span> — لا يُفعَّل الاشتراك إلا بعد تأكيد الإدارة للتحويل.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
        {/* Was labelled «الباقة» while printing the transfer method. */}
        <li>الباقة: <span className="font-medium text-text-primary">{PLAN_LABEL(req.targetPlanCode)}</span> • {CYCLE_LABEL[req.billingCycle]}</li>
        <li>وسيلة التحويل: <span className="font-medium text-text-primary">{METHOD_LABEL[ins.method]}</span></li>
        <li>المبلغ: <span className="font-semibold text-text-primary">{formatMoney(ins.amountMinor, ins.currencyCode)}</span></li>
        <li className="break-all">
          {ins.payToHandle ? (
            <>حوّل إلى: <span dir="ltr" className="font-semibold text-text-primary">{ins.payToHandle}</span></>
          ) : (
            <span className="text-danger">وسيلة التحويل هذه غير مُفعَّلة على الخادم — تواصل مع الدعم قبل التحويل.</span>
          )}
        </li>
        <li>كود العملية: <span className="font-mono font-semibold text-text-primary">{req.humanCode}</span></li>
      </ul>
      {ins.whatsapp.available && ins.whatsapp.deeplink ? (
        <Button asChild className="w-full justify-center sm:w-auto sm:self-start">
          <a href={ins.whatsapp.deeplink} target="_blank" rel="noopener noreferrer">أرسل إثبات التحويل عبر واتساب</a>
        </Button>
      ) : (
        <p className="text-xs text-text-tertiary">قناة واتساب غير مُهيّأة بعد — احتفظ بكود العملية وتواصل مع الدعم لإرسال إثبات التحويل.</p>
      )}
    </div>
  );
}
