"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { PaymentMethod } from "@academic-precision/contracts";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, formatMoney, toast } from "@academic-precision/ui";
import { recordPayment } from "../../lib/api/finance";
import { useWorkspace } from "../../lib/workspace-provider";

interface FormValues {
  amount: string;
  method: PaymentMethod;
  note?: string;
}

/**
 * The one shared "record a payment" flow (used from Student Profile,
 * Finance collection queue). `amountMinor` is derived from the entered
 * major-unit amount at submit time only — never stored/compared as a
 * float anywhere else (§22 "no floating point calculations in the UI").
 */
export function RecordPaymentDialog({ obligationId, remainingMinor, open, onOpenChange, onRecorded }: { obligationId: string; remainingMinor: number; open: boolean; onOpenChange: (open: boolean) => void; onRecorded?: () => void }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState } = useForm<FormValues>({ defaultValues: { method: "CASH" } });
  const [method, setMethod] = useState<PaymentMethod>("CASH");

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const amountMinor = Math.round(Number(values.amount) * 100);
      return recordPayment(workspaceId!, { obligationId, amountMinor, method, note: values.note || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("تم تسجيل الدفعة");
      onOpenChange(false);
      reset();
      onRecorded?.();
    },
    onError: () => toast.error("تعذّر تسجيل الدفعة"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل دفعة</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          <p className="text-sm text-text-secondary">المتبقي حاليًا: {formatMoney(remainingMinor)}</p>
          <Field label="المبلغ" htmlFor="amount" required error={formState.errors.amount?.message}>
            <Input id="amount" type="number" step="0.01" min="0.01" max={remainingMinor / 100} dir="ltr" {...register("amount", { required: "المبلغ مطلوب", min: { value: 0.01, message: "المبلغ يجب أن يكون أكبر من صفر" }, max: { value: remainingMinor / 100, message: `المبلغ يتجاوز المتبقّي (${formatMoney(remainingMinor)})` } })} />
          </Field>
          <Field label="طريقة الدفع" htmlFor="method">
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">نقدًا</SelectItem>
                <SelectItem value="TRANSFER">تحويل بنكي</SelectItem>
                <SelectItem value="WALLET">محفظة إلكترونية</SelectItem>
                <SelectItem value="OTHER">أخرى</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="ملاحظة" htmlFor="note" hint="اختياري">
            <Input id="note" {...register("note")} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>
              تسجيل الدفعة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
