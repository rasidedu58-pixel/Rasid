"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, formatMoney, toast } from "@academic-precision/ui";
import { reversePayment } from "../../../lib/api/finance";
import { invalidateFinanceCaches } from "../../../lib/finance-cache";
import { useWorkspace } from "../../../lib/workspace-provider";

/**
 * Reverses a POSTED payment (§29). The payment is never deleted — the backend
 * marks it REVERSED and writes a payment_reversals row + audit, keeping the
 * full ledger. A reason is required.
 */
/**
 * Why a CATEGORY and not just free text: the three cases are different
 * facts and the audit trail has to tell them apart — a mis-entry (no money
 * ever moved), a wrong amount/method (to be re-entered correctly), and a
 * real refund (money went back to the student). Rasid has NO separate
 * refund/credit ledger in V1, so for a refund this cancellation is the only
 * record — and the dialog says that outright instead of implying a refund
 * was processed.
 */
const REASON_CATEGORIES = [
  { value: "WRONG_ENTRY", label: "سُجِّلت بالخطأ — لم يُدفع المبلغ أصلًا" },
  { value: "WRONG_AMOUNT", label: "المبلغ أو طريقة الدفع غير صحيحة" },
  { value: "REFUND", label: "استُرِدَّت الفلوس للطالب فعليًا" },
  { value: "OTHER", label: "سبب آخر" },
] as const;
type ReasonCategory = (typeof REASON_CATEGORIES)[number]["value"];
const CATEGORY_LABEL: Record<ReasonCategory, string> = REASON_CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.value]: c.label }),
  {} as Record<ReasonCategory, string>,
);

export function ReversePaymentDialog({
  paymentId,
  amountMinor,
  studentName,
  onClose,
  onDone,
}: {
  paymentId: string;
  amountMinor: number;
  studentName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<ReasonCategory | "">("");
  const [detail, setDetail] = useState("");

  // The backend stores ONE free-text `reason` (no schema change here), so the
  // chosen category is written into it verbatim — the audit trail then says
  // WHY the registration was cancelled, not just that it was.
  const reason = category ? [CATEGORY_LABEL[category], detail.trim()].filter(Boolean).join(" — ") : "";

  const reverse = useMutation({
    mutationFn: () => reversePayment(workspaceId!, paymentId, { reason: reason.trim() }),
    onSuccess: () => {
      // The fix for "the cancelled payment is still counted": the
      // obligation's collected/remaining figures changed server-side, so
      // EVERY cache that shows them has to go — not just the ledger this
      // dialog happens to be opened from.
      invalidateFinanceCaches(queryClient, workspaceId!);
      toast.success("تم إلغاء تسجيل الدفعة");
      onDone();
      onClose();
    },
    onError: () => toast.error("تعذّر إلغاء تسجيل الدفعة"),
  });

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إلغاء تسجيل دفعة {studentName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
            <span className="text-sm text-text-secondary">مبلغ الدفعة</span>
            <span className="text-base font-bold tabular-nums text-text-primary">{formatMoney(amountMinor)}</span>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            سيظل تسجيل الدفعة محفوظًا في السجل كدفعة ملغاة، وسيُعاد احتساب المبلغ المتبقي على الطالب. لا يمكن التراجع عن الإلغاء.
          </p>
          <Field label="سبب الإلغاء" htmlFor="reason-category" required>
            <Select value={category} onValueChange={(v) => setCategory(v as ReasonCategory)}>
              <SelectTrigger id="reason-category">
                <SelectValue placeholder="اختر السبب" />
              </SelectTrigger>
              <SelectContent>
                {REASON_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {category === "REFUND" ? (
            <p className="rounded-lg border border-warning/30 bg-warning-subtle/30 px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
              راصد يسجّل إلغاء الدفعة فقط ولا يسجّل حركة استرداد مالية منفصلة — سيعود المتبقي على الطالب كما كان قبل الدفعة، فاحتفظ بإثبات الاسترداد خارج النظام.
            </p>
          ) : null}
          <Field label="تفاصيل إضافية" htmlFor="reason-detail" hint="اختياري">
            <Input id="reason-detail" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="مثال: الطالب دفع 200 وليس 300" autoFocus />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>رجوع</Button>
          <Button variant="danger" loading={reverse.isPending} disabled={!category} onClick={() => reverse.mutate()}>
            تأكيد الإلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
