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
  formatMoney,
  toast,
} from "@academic-precision/ui";
import {
  STANDARD_PLAN_LIST,
  type BillingCycle,
  type BillingPaymentMethod,
  type CreatePaymentRequestResponse,
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
const STATUS_LABEL: Record<PaymentRequestDto["status"], string> = {
  PENDING: "بانتظار التأكيد",
  CONFIRMED: "مؤكَّد — تم التفعيل",
  REJECTED: "مرفوض",
  CANCELLED: "ملغى",
  EXPIRED: "منتهي",
};
const METHOD_LABEL: Record<BillingPaymentMethod, string> = { INSTAPAY: "إنستاباي", VODAFONE_CASH: "فودافون كاش" };
const CYCLE_LABEL: Record<BillingCycle, string> = { MONTHLY: "شهري", ANNUAL: "سنوي" };

/** Minimal manual-payment flow (Billing Phase 3): pick plan/cycle/method → create request → pay + send WhatsApp proof → see status. */
export function PaymentRequestPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [planCode, setPlanCode] = useState<string>("PROFESSIONAL");
  const [cycle, setCycle] = useState<BillingCycle>("MONTHLY");
  const [method, setMethod] = useState<BillingPaymentMethod>("INSTAPAY");
  const [created, setCreated] = useState<CreatePaymentRequestResponse | null>(null);

  const listQuery = useQuery({
    queryKey: ["billing", "payment-requests", workspaceId],
    queryFn: () => listPaymentRequests(workspaceId),
  });

  const createMutation = useMutation({
    mutationFn: () => createPaymentRequest(workspaceId, { planCode: planCode as never, billingCycle: cycle, paymentMethod: method }),
    onSuccess: (res) => {
      setCreated(res);
      queryClient.invalidateQueries({ queryKey: ["billing", "payment-requests", workspaceId] });
    },
    onError: () => toast.error("تعذّر إنشاء طلب الدفع"),
  });

  const selectedPlan = STANDARD_PLAN_LIST.find((p) => p.code === planCode);
  const priceMinor = selectedPlan ? (cycle === "ANNUAL" ? selectedPlan.annualPriceMinor : selectedPlan.monthlyPriceMinor) : 0;
  const latest = listQuery.data?.paymentRequests[0];

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary">الاشتراك المدفوع</h3>
        <p className="mt-1 text-sm text-text-secondary">اختر باقتك وطريقة الدفع، ثم أرسل إثبات التحويل عبر واتساب.</p>
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

      {/* Selection */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
          <span className="text-text-secondary">الدورة</span>
          <Select value={cycle} onValueChange={(v) => setCycle(v as BillingCycle)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="MONTHLY">شهري</SelectItem>
              <SelectItem value="ANNUAL">سنوي (شهران مجانًا)</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">طريقة الدفع</span>
          <Select value={method} onValueChange={(v) => setMethod(v as BillingPaymentMethod)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="INSTAPAY">إنستاباي</SelectItem>
              <SelectItem value="VODAFONE_CASH">فودافون كاش</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          المبلغ: <span className="font-semibold text-text-primary">{formatMoney(priceMinor)}</span>
        </span>
        <Button onClick={() => createMutation.mutate()} loading={createMutation.isPending}>
          إنشاء طلب الدفع
        </Button>
      </div>

      {/* Payment instructions (after create) */}
      {created ? <PaymentInstructionsCard created={created} /> : null}
    </Card>
  );
}

function PaymentInstructionsCard({ created }: { created: CreatePaymentRequestResponse }) {
  const { paymentRequest: req, instructions: ins } = created;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand-subtle/30 p-4">
      <p className="text-sm font-semibold text-text-primary">تعليمات الدفع</p>
      <ul className="flex flex-col gap-1 text-sm text-text-secondary">
        <li>الباقة: {METHOD_LABEL[ins.method]} • {CYCLE_LABEL[req.billingCycle]}</li>
        <li>المبلغ: <span className="font-semibold text-text-primary">{formatMoney(ins.amountMinor, ins.currencyCode)}</span></li>
        <li>
          {ins.payToHandle
            ? <>حوّل إلى: <span className="font-semibold text-text-primary">{ins.payToHandle}</span></>
            : <span className="text-danger">قناة الدفع غير متاحة حاليًا — تواصل مع الدعم.</span>}
        </li>
        <li>كود العملية: <span className="font-mono font-semibold text-text-primary">{req.humanCode}</span></li>
      </ul>
      {ins.whatsapp.available && ins.whatsapp.deeplink ? (
        <Button asChild className="self-start">
          <a href={ins.whatsapp.deeplink} target="_blank" rel="noopener noreferrer">إرسال إثبات الدفع عبر واتساب</a>
        </Button>
      ) : (
        <p className="text-xs text-text-tertiary">قناة واتساب غير مُهيّأة بعد — احتفظ بكود العملية وتواصل مع الدعم.</p>
      )}
    </div>
  );
}
