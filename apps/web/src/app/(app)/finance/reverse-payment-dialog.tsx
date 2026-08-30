"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, formatMoney, toast } from "@academic-precision/ui";
import { reversePayment } from "../../../lib/api/finance";
import { useWorkspace } from "../../../lib/workspace-provider";

/**
 * Reverses a POSTED payment (§29). The payment is never deleted — the backend
 * marks it REVERSED and writes a payment_reversals row + audit, keeping the
 * full ledger. A reason is required.
 */
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
  const [reason, setReason] = useState("");

  const reverse = useMutation({
    mutationFn: () => reversePayment(workspaceId!, paymentId, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success("تم عكس الدفعة");
      onDone();
      onClose();
    },
    onError: () => toast.error("تعذّر عكس الدفعة"),
  });

  return (
    <Dialog open onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>عكس دفعة {studentName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
            <span className="text-sm text-text-secondary">مبلغ الدفعة</span>
            <span className="text-base font-bold tabular-nums text-text-primary">{formatMoney(amountMinor)}</span>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            لن تُحذف الدفعة — ستُسجَّل كـ«معكوسة» مع بقاء أثرها الكامل في السجل، ويُعاد احتساب المتبقّي على الطالب. لا يمكن التراجع عن العكس.
          </p>
          <Field label="سبب العكس" htmlFor="reason" required>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: سُجّلت بالخطأ" autoFocus />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="danger" loading={reverse.isPending} disabled={!reason.trim()} onClick={() => reverse.mutate()}>
            تأكيد العكس
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
