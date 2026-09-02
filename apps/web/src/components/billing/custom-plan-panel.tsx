"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
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
import type { BillingPaymentMethod, CreatePaymentRequestResponse, CustomOfferDto } from "@academic-precision/contracts";
import {
  acceptCustomOffer,
  cancelCustomRequest,
  createCustomPayment,
  createCustomRequest,
  fetchCustomState,
  rejectCustomOffer,
} from "../../lib/api/billing";
import { PaymentInstructionsCard } from "./payment-request-panel";

/** Phase 5 — customer custom-plan flow: eligibility CTA → request → offer view → accept → payment. Owner-gated by the page. */
export function CustomPlanPanel({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const stateQuery = useQuery({ queryKey: ["billing", "custom-state", workspaceId], queryFn: () => fetchCustomState(workspaceId) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["billing", "custom-state", workspaceId] });

  if (stateQuery.isLoading) return <LoadingRegion />;
  if (stateQuery.isError || !stateQuery.data) return <ErrorState onRetry={() => stateQuery.refetch()} />;
  const s = stateQuery.data.customState;
  const isCustom = s.currentPlanCode === "CUSTOM";

  // Nothing to show unless custom is relevant (near/at the ceiling, an open request, an offer, or already CUSTOM).
  if (!s.customCtaVisible && !s.request && !s.offer && !isCustom) return null;

  const offer = s.offer;
  const showAcceptedPayment = offer && offer.status === "ACCEPTED";
  const showPendingOffer = offer && offer.status === "PENDING_CUSTOMER";

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-base font-semibold text-text-primary">الباقة المخصصة</h3>
        <p className="mt-1 text-sm text-text-secondary">للمجموعات الأكبر من 3000 طالب — يُتفق على الحدود والسعر مع فريق راصد.</p>
      </div>

      {showPendingOffer ? (
        <OfferView workspaceId={workspaceId} offer={offer!} onChanged={invalidate} />
      ) : showAcceptedPayment ? (
        <AcceptedOfferPayment workspaceId={workspaceId} offer={offer!} />
      ) : s.request && s.request.status === "PENDING_REVIEW" ? (
        <PendingRequest workspaceId={workspaceId} onChanged={invalidate} />
      ) : (
        <RequestForm workspaceId={workspaceId} onChanged={invalidate} />
      )}
    </Card>
  );
}

function RequestForm({ workspaceId, onChanged }: { workspaceId: string; onChanged: () => void }) {
  const [students, setStudents] = useState<string>("3500");
  const [team, setTeam] = useState<string>("15");
  const [note, setNote] = useState<string>("");

  const mutation = useMutation({
    mutationFn: () =>
      createCustomRequest(workspaceId, { requestedMaxActiveStudents: Number(students), requestedMaxTeamMembers: Number(team), preferredBillingCycle: "MONTHLY", customerNote: note || undefined }),
    onSuccess: () => { toast.success("تم إرسال طلب الباقة المخصصة."); onChanged(); },
    onError: () => toast.error("تعذّر إرسال الطلب (تأكد أن عدد الطلاب أكثر من 3000)."),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">عدد الطلاب المطلوب</span>
          <Input type="number" min={3001} value={students} onChange={(e) => setStudents(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text-secondary">أعضاء الفريق المطلوب</span>
          <Input type="number" min={0} value={team} onChange={(e) => setTeam(e.target.value)} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-text-secondary">ملاحظة (اختياري)</span>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="أي تفاصيل تشغيلية تساعدنا" />
      </label>
      <Button className="self-start" onClick={() => mutation.mutate()} loading={mutation.isPending}>طلب باقة مخصصة</Button>
    </div>
  );
}

function PendingRequest({ workspaceId, onChanged }: { workspaceId: string; onChanged: () => void }) {
  const cancelMutation = useMutation({ mutationFn: () => cancelCustomRequest(workspaceId), onSuccess: () => { toast.success("تم إلغاء الطلب."); onChanged(); }, onError: () => toast.error("تعذّر الإلغاء.") });
  return (
    <div className="flex items-center justify-between rounded-lg border border-warning/40 bg-warning-subtle/30 px-3 py-2 text-sm">
      <span className="text-text-secondary">طلبك <Badge tone="warning">قيد المراجعة</Badge> — سنرسل لك عرضًا قريبًا.</span>
      <Button variant="ghost" size="sm" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>إلغاء الطلب</Button>
    </div>
  );
}

function OfferView({ workspaceId, offer, onChanged }: { workspaceId: string; offer: CustomOfferDto; onChanged: () => void }) {
  const accept = useMutation({ mutationFn: () => acceptCustomOffer(workspaceId, offer.id), onSuccess: () => { toast.success("تم قبول العرض. أكمل الدفع لتفعيل الباقة."); onChanged(); }, onError: () => toast.error("تعذّر قبول العرض (قد يكون منتهيًا).") });
  const reject = useMutation({ mutationFn: () => rejectCustomOffer(workspaceId, offer.id), onSuccess: () => { toast.success("تم رفض العرض."); onChanged(); }, onError: () => toast.error("تعذّر رفض العرض.") });
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-brand/30 bg-brand-subtle/20 p-4 text-sm">
      <p className="font-semibold text-text-primary">عرض باقتك المخصصة</p>
      <Row label="حد الطلاب" value={`${offer.maxActiveStudents}`} />
      <Row label="أعضاء الفريق" value={`${offer.maxTeamMembers}`} />
      <Row label="الدورة" value={offer.billingCycle === "ANNUAL" ? "سنوي" : "شهري"} />
      <Row label="السعر المتفق" value={formatMoney(offer.priceMinor, offer.currencyCode)} strong />
      {offer.validUntil ? <p className="text-xs text-text-tertiary">صالح حتى {formatDate(offer.validUntil)}</p> : null}
      <div className="flex gap-2">
        <Button onClick={() => accept.mutate()} loading={accept.isPending}>قبول العرض</Button>
        <Button variant="outline" onClick={() => reject.mutate()} loading={reject.isPending}>رفض</Button>
      </div>
    </div>
  );
}

function AcceptedOfferPayment({ workspaceId, offer }: { workspaceId: string; offer: CustomOfferDto }) {
  const [method, setMethod] = useState<BillingPaymentMethod>("INSTAPAY");
  const [created, setCreated] = useState<CreatePaymentRequestResponse | null>(null);
  const mutation = useMutation({
    mutationFn: () => createCustomPayment(workspaceId, { acceptedOfferId: offer.id, paymentMethod: method }),
    onSuccess: (res) => setCreated(res),
    onError: () => toast.error("تعذّر إنشاء طلب الدفع."),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-success/40 bg-success-subtle/20 p-3 text-sm text-text-secondary">
        تم قبول العرض ({offer.maxActiveStudents} طالب • {formatMoney(offer.priceMinor, offer.currencyCode)}). أكمل الدفع لتفعيل الباقة المخصصة.
      </div>
      <div className="flex items-end justify-between gap-3">
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
        <Button onClick={() => mutation.mutate()} loading={mutation.isPending}>إنشاء طلب الدفع</Button>
      </div>
      {created ? <PaymentInstructionsCard created={created} /> : null}
    </div>
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
