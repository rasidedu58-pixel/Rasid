"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Copy, UserPlus } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  toast,
} from "@academic-precision/ui";
import { hasPlatformPermission } from "@academic-precision/contracts";
import { qk } from "../../lib/query-keys";
import { useWorkspace } from "../../lib/workspace-provider";
import { createCustomerInvitation, fetchCustomerInvitations, revokeCustomerInvitation } from "../../lib/api/platform-operations";
import { formatDateTime } from "@academic-precision/ui";

/**
 * Customer Creation via Secure Invite (platform.customers.manage). The admin
 * NEVER sets a password — they record the customer's identity and mint a
 * secure, single-use, expiring onboarding link. The customer completes their
 * own account through the normal auth flow; their workspace + trial come from
 * the existing lazy provisioning.
 */
export function CustomerCreate() {
  const { platformRole } = useWorkspace();
  const canManage = hasPlatformPermission(platformRole, "platform.customers.manage");
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const invites = useQuery({
    queryKey: qk.platformAdmin.customerInvitations(),
    queryFn: () => fetchCustomerInvitations({ limit: 50 }),
    enabled: canManage,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.platformAdmin.customerInvitations() });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeCustomerInvitation(id),
    onSuccess: () => {
      invalidate();
      toast.success("تم إلغاء الدعوة");
    },
    onError: () => toast.error("تعذّر الإلغاء"),
  });

  if (!canManage) return null;
  const pending = (invites.data?.items ?? []).filter((i) => i.status === "PENDING");

  return (
    <Card className="mb-4">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-semibold text-text-primary">إضافة عميل</h2>
            <p className="text-xs text-text-tertiary">أنشئ رابط تفعيل آمن — بدون كلمة مرور. يكمل العميل حسابه بنفسه.</p>
          </div>
          <Button className="ms-auto gap-2" onClick={() => setOpen(true)}>
            <UserPlus className="h-4 w-4" aria-hidden />
            إضافة عميل
          </Button>
        </div>

        {pending.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-text-primary">{inv.fullName}</span>
                  <span className="text-xs text-text-tertiary" dir="ltr">
                    {inv.email} · تنتهي {formatDateTime(inv.expiresAt)}
                    {inv.expired ? " · منتهية" : ""}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="ms-auto" loading={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                  إلغاء
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>

      {open ? <CreateCustomerDialog onClose={() => setOpen(false)} onDone={invalidate} /> : null}
    </Card>
  );
}

function CreateCustomerDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, formState } = useForm<{ fullName: string; email: string; phone?: string }>();
  const [link, setLink] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { fullName: string; email: string; phone?: string }) =>
      createCustomerInvitation({ fullName: v.fullName, email: v.email, phone: v.phone || undefined }),
    onSuccess: (res) => {
      onDone();
      setLink(`${window.location.origin}/welcome/${res.token}`);
      toast.success("تم إنشاء رابط التفعيل");
    },
    onError: () => toast.error("تعذّر إنشاء الدعوة"),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة عميل جديد</DialogTitle>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">شارك رابط التفعيل مع العميل. يُفتح مرة واحدة وينتهي خلال 14 يومًا.</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted p-2">
              <span className="min-w-0 flex-1 truncate text-xs" dir="ltr">{link}</span>
              <Button size="sm" variant="secondary" className="gap-1" onClick={() => void navigator.clipboard?.writeText(link).then(() => toast.success("تم النسخ"))}>
                <Copy className="h-3.5 w-3.5" aria-hidden />
                نسخ
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>تم</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
            <Field label="الاسم" htmlFor="fullName" required error={formState.errors.fullName?.message}>
              <Input id="fullName" {...register("fullName", { required: "الاسم مطلوب" })} />
            </Field>
            <Field label="البريد الإلكتروني" htmlFor="email" required error={formState.errors.email?.message}>
              <Input id="email" type="email" dir="ltr" {...register("email", { required: "البريد مطلوب" })} />
            </Field>
            <Field label="الهاتف" htmlFor="phone" hint="اختياري">
              <Input id="phone" dir="ltr" {...register("phone")} />
            </Field>
            <p className="text-xs text-text-tertiary">لا يتم إنشاء كلمة مرور. لا تُنشأ مساحة عمل قبل أن يُكمل العميل التسجيل بنفسه.</p>
            <DialogFooter>
              <Button type="submit" loading={mutation.isPending}>إنشاء رابط التفعيل</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
