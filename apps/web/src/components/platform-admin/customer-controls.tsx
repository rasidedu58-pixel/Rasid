"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Textarea,
  SectionCard,
  toast,
} from "@academic-precision/ui";
import { hasPlatformPermission } from "@academic-precision/contracts";
import { qk } from "../../lib/query-keys";
import { useWorkspace } from "../../lib/workspace-provider";
import { customerAccountAction, editCustomer, subscriptionAdminAction } from "../../lib/api/platform-operations";

type SubAction = "EXTEND_DAYS" | "SET_END_DATE" | "SUSPEND" | "REACTIVATE";

/**
 * Customer & Subscription controls inside Customer 360. Every action requires a
 * reason and is audited server-side (before/after). Gated by
 * platform.customers.manage / platform.subscriptions.manage (server enforces).
 * NO hard delete — deletion is deliberately unavailable in V1.
 */
export function CustomerControls({ workspaceId, status, canViewSubscription }: { workspaceId: string; status: string; canViewSubscription: boolean }) {
  const { platformRole } = useWorkspace();
  const canManageCustomer = hasPlatformPermission(platformRole, "platform.customers.manage");
  const canManageSub = hasPlatformPermission(platformRole, "platform.subscriptions.manage");
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.platformAdmin.workspace(workspaceId) });
    queryClient.invalidateQueries({ queryKey: qk.platformAdmin.workspaceSubscription(workspaceId) });
  };

  const [dialog, setDialog] = useState<null | { kind: "account"; action: "SUSPEND" | "REACTIVATE" } | { kind: "edit" } | { kind: "sub"; action: SubAction }>(null);
  const isActive = status === "ACTIVE";

  if (!canManageCustomer && !canManageSub) return null;

  return (
    <>
      {canManageCustomer ? (
        <SectionCard title="التحكم في الحساب" description="إجراءات حسّاسة — يتطلب كل إجراء سببًا ويُسجَّل في التدقيق.">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-text-secondary">حالة الحساب:</span>
              <Badge tone={isActive ? "success" : "neutral"}>{isActive ? "نشط" : "موقوف"}</Badge>
              <span className="ms-auto flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "edit" })}>
                  تعديل البيانات
                </Button>
                {isActive ? (
                  <Button size="sm" variant="danger" onClick={() => setDialog({ kind: "account", action: "SUSPEND" })}>
                    إيقاف الحساب
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setDialog({ kind: "account", action: "REACTIVATE" })}>
                    إعادة تفعيل
                  </Button>
                )}
              </span>
            </div>
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-text-tertiary">
              الحذف الكامل للحساب غير متاح حاليًا (لا Hard Delete) — الإيقاف قابل للعكس.
            </p>
          </div>
        </SectionCard>
      ) : null}

      {canManageSub && canViewSubscription ? (
        <SectionCard title="التحكم في الاشتراك" description="تمديد التجربة / تعديل تاريخ الانتهاء / إيقاف / إعادة تفعيل — بسبب إلزامي وتدقيق.">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "sub", action: "EXTEND_DAYS" })}>تمديد بعدد أيام</Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "sub", action: "SET_END_DATE" })}>تعديل تاريخ الانتهاء</Button>
            <Button size="sm" variant="danger" onClick={() => setDialog({ kind: "sub", action: "SUSPEND" })}>إيقاف الاشتراك</Button>
            <Button size="sm" onClick={() => setDialog({ kind: "sub", action: "REACTIVATE" })}>إعادة تفعيل</Button>
          </div>
        </SectionCard>
      ) : null}

      {dialog?.kind === "account" ? (
        <ReasonDialog
          title={dialog.action === "SUSPEND" ? "إيقاف حساب العميل" : "إعادة تفعيل الحساب"}
          onClose={() => setDialog(null)}
          mutationFn={(reason) => customerAccountAction(workspaceId, { action: dialog.action, reason })}
          onDone={invalidate}
          successMsg="تم تحديث حالة الحساب"
        />
      ) : null}

      {dialog?.kind === "edit" ? (
        <EditCustomerDialog workspaceId={workspaceId} onClose={() => setDialog(null)} onDone={invalidate} />
      ) : null}

      {dialog?.kind === "sub" ? (
        <SubscriptionActionDialog workspaceId={workspaceId} action={dialog.action} onClose={() => setDialog(null)} onDone={invalidate} />
      ) : null}
    </>
  );
}

function ReasonDialog({ title, onClose, mutationFn, onDone, successMsg }: { title: string; onClose: () => void; mutationFn: (reason: string) => Promise<unknown>; onDone: () => void; successMsg: string }) {
  const { register, handleSubmit, formState } = useForm<{ reason: string }>();
  const mutation = useMutation({
    mutationFn: (v: { reason: string }) => mutationFn(v.reason),
    onSuccess: () => {
      onDone();
      toast.success(successMsg);
      onClose();
    },
    onError: () => toast.error("تعذّر تنفيذ الإجراء"),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          <Field label="السبب" htmlFor="reason" required error={formState.errors.reason?.message}>
            <Textarea id="reason" rows={3} {...register("reason", { required: "السبب مطلوب" })} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>تأكيد</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCustomerDialog({ workspaceId, onClose, onDone }: { workspaceId: string; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, formState } = useForm<{ name?: string; ownerPhone?: string; reason: string }>();
  const mutation = useMutation({
    mutationFn: (v: { name?: string; ownerPhone?: string; reason: string }) =>
      editCustomer(workspaceId, { name: v.name || undefined, ownerPhone: v.ownerPhone || undefined, reason: v.reason }),
    onSuccess: () => {
      onDone();
      toast.success("تم تحديث بيانات العميل");
      onClose();
    },
    onError: () => toast.error("تعذّر التعديل"),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تعديل بيانات العميل</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          <Field label="اسم المساحة" htmlFor="name" hint="اتركه فارغًا لعدم التغيير">
            <Input id="name" {...register("name")} />
          </Field>
          <Field label="هاتف المالك" htmlFor="ownerPhone" hint="اتركه فارغًا لعدم التغيير">
            <Input id="ownerPhone" dir="ltr" {...register("ownerPhone")} />
          </Field>
          <Field label="السبب" htmlFor="reason" required error={formState.errors.reason?.message}>
            <Textarea id="reason" rows={2} {...register("reason", { required: "السبب مطلوب" })} />
          </Field>
          <p className="text-xs text-text-tertiary">البريد/هوية الدخول لا تُعدَّل من هنا (تتطلب تدفقًا أمنيًا منفصلًا).</p>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>حفظ</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SUB_ACTION_TITLE: Record<SubAction, string> = {
  EXTEND_DAYS: "تمديد الاشتراك بعدد أيام",
  SET_END_DATE: "تعديل تاريخ الانتهاء",
  SUSPEND: "إيقاف الاشتراك",
  REACTIVATE: "إعادة تفعيل الاشتراك",
};

function SubscriptionActionDialog({ workspaceId, action, onClose, onDone }: { workspaceId: string; action: SubAction; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, formState } = useForm<{ reason: string; days?: string; endDate?: string }>();
  const mutation = useMutation({
    mutationFn: (v: { reason: string; days?: string; endDate?: string }) =>
      subscriptionAdminAction(workspaceId, {
        action,
        reason: v.reason,
        days: action === "EXTEND_DAYS" && v.days ? Number(v.days) : undefined,
        endDate: action === "SET_END_DATE" && v.endDate ? new Date(v.endDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      onDone();
      toast.success("تم تحديث الاشتراك");
      onClose();
    },
    onError: () => toast.error("تعذّر تحديث الاشتراك"),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{SUB_ACTION_TITLE[action]}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          {action === "EXTEND_DAYS" ? (
            <Field label="عدد الأيام" htmlFor="days" required error={formState.errors.days?.message}>
              <Input id="days" type="number" min="1" max="365" dir="ltr" {...register("days", { required: "عدد الأيام مطلوب" })} />
            </Field>
          ) : null}
          {action === "SET_END_DATE" ? (
            <Field label="تاريخ الانتهاء" htmlFor="endDate" required error={formState.errors.endDate?.message}>
              <Input id="endDate" type="datetime-local" dir="ltr" {...register("endDate", { required: "التاريخ مطلوب" })} />
            </Field>
          ) : null}
          <Field label="السبب" htmlFor="reason" required error={formState.errors.reason?.message}>
            <Textarea id="reason" rows={2} {...register("reason", { required: "السبب مطلوب" })} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>تأكيد</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
