"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Copy, UserPlus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
  LoadingRegion,
  PermissionDeniedState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
  formatDateTime,
  toast,
} from "@academic-precision/ui";
import { PLATFORM_ROLES, type PlatformRole, type PlatformStaffMember } from "@academic-precision/contracts";
import { PageHeader } from "../../../components/shell/page-header";
import { qk } from "../../../lib/query-keys";
import { isForbidden } from "../../../lib/api/client";
import { PLATFORM_ROLE_LABEL } from "../../../lib/platform-labels";
import {
  changePlatformStaffRole,
  createPlatformStaffInvitation,
  fetchPlatformStaffInvitations,
  fetchPlatformStaffMembers,
  platformStaffAccountAction,
  revokePlatformStaffInvitation,
} from "../../../lib/api/platform-operations";

/**
 * Platform Staff Management ("فريق راصد") — OWNER-only. Invite by secure link
 * (no password ever set), change role, disable / reactivate. The server
 * enforces platform.staff.manage and the last-active-owner invariant.
 */
export default function PlatformStaffPage() {
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: qk.platformAdmin.staffMembers(), queryFn: fetchPlatformStaffMembers });
  const invitations = useQuery({ queryKey: qk.platformAdmin.staffInvitations(), queryFn: fetchPlatformStaffInvitations });

  const [inviteOpen, setInviteOpen] = useState(false);
  const [reasonDialog, setReasonDialog] = useState<
    | null
    | { kind: "role"; member: PlatformStaffMember; role: PlatformRole }
    | { kind: "status"; member: PlatformStaffMember; action: "DISABLE" | "REACTIVATE" }
  >(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.platformAdmin.staffMembers() });
    queryClient.invalidateQueries({ queryKey: qk.platformAdmin.staffInvitations() });
  };

  if (staff.isError && isForbidden(staff.error)) {
    return <PermissionDeniedState description="إدارة فريق راصد متاحة لمالك المنصة فقط." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="فريق راصد"
        description="موظفو وشركاء تشغيل المنصة. لكل عضو حساب مستقل — لا تُشارك حساب المؤسس."
        actions={
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="h-4 w-4" aria-hidden />
            دعوة عضو
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {staff.isLoading ? (
            <LoadingRegion label="جارٍ تحميل الفريق…" />
          ) : staff.isError ? (
            <ErrorState description="تعذّر تحميل الفريق." />
          ) : (
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>العضو</TableHead>
                    <TableHead>الدور</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>دُعي بواسطة</TableHead>
                    <TableHead>منذ</TableHead>
                    <TableHead className="text-end">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(staff.data?.items ?? []).map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-text-primary">{m.fullName ?? "—"}</span>
                          <span className="text-xs text-text-tertiary" dir="ltr">{m.email ?? "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={m.role}
                          onValueChange={(v) => {
                            if (v !== m.role) setReasonDialog({ kind: "role", member: m, role: v as PlatformRole });
                          }}
                          disabled={m.isSelf}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PLATFORM_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {PLATFORM_ROLE_LABEL[r] ?? r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status === "ACTIVE" ? "نشط" : "معطّل"}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-text-secondary">{m.invitedByName ?? "—"}</TableCell>
                      <TableCell className="text-xs text-text-tertiary">{formatDateTime(m.grantedAt)}</TableCell>
                      <TableCell className="text-end">
                        {m.isSelf ? (
                          <span className="text-xs text-text-tertiary">حسابك</span>
                        ) : m.status === "ACTIVE" ? (
                          <Button size="sm" variant="danger" onClick={() => setReasonDialog({ kind: "status", member: m, action: "DISABLE" })}>
                            تعطيل
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setReasonDialog({ kind: "status", member: m, action: "REACTIVATE" })}>
                            إعادة تفعيل
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          )}
        </CardContent>
      </Card>

      <PendingInvitations invitations={invitations.data?.items ?? []} loading={invitations.isLoading} onChanged={invalidate} />

      {inviteOpen ? <InviteStaffDialog onClose={() => setInviteOpen(false)} onDone={invalidate} /> : null}

      {reasonDialog?.kind === "role" ? (
        <ReasonDialog
          title={`تغيير دور ${reasonDialog.member.fullName ?? "العضو"} إلى «${PLATFORM_ROLE_LABEL[reasonDialog.role]}»`}
          onClose={() => setReasonDialog(null)}
          onDone={invalidate}
          successMsg="تم تغيير الدور"
          mutationFn={(reason) => changePlatformStaffRole(reasonDialog.member.userId, { role: reasonDialog.role, reason })}
        />
      ) : null}

      {reasonDialog?.kind === "status" ? (
        <ReasonDialog
          title={reasonDialog.action === "DISABLE" ? `تعطيل وصول ${reasonDialog.member.fullName ?? "العضو"}` : `إعادة تفعيل ${reasonDialog.member.fullName ?? "العضو"}`}
          onClose={() => setReasonDialog(null)}
          onDone={invalidate}
          successMsg="تم تحديث الحالة"
          mutationFn={(reason) => platformStaffAccountAction(reasonDialog.member.userId, { action: reasonDialog.action, reason })}
        />
      ) : null}
    </div>
  );
}

function PendingInvitations({ invitations, loading, onChanged }: { invitations: import("@academic-precision/contracts").PlatformStaffInvitation[]; loading: boolean; onChanged: () => void }) {
  const revoke = useMutation({
    mutationFn: (id: string) => revokePlatformStaffInvitation(id),
    onSuccess: () => {
      onChanged();
      toast.success("تم إلغاء الدعوة");
    },
    onError: () => toast.error("تعذّر الإلغاء"),
  });
  const pending = invitations.filter((i) => i.status === "PENDING");
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-text-primary">الدعوات المعلّقة</h2>
        {loading ? (
          <LoadingRegion label="…" />
        ) : pending.length === 0 ? (
          <p className="text-sm text-text-tertiary">لا توجد دعوات معلّقة.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {pending.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2.5">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-text-primary" dir="ltr">{inv.email}</span>
                  <span className="text-xs text-text-tertiary">
                    {PLATFORM_ROLE_LABEL[inv.role] ?? inv.role} · تنتهي {formatDateTime(inv.expiresAt)}
                    {inv.expired ? " · منتهية" : ""}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="ms-auto" loading={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                  إلغاء
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InviteStaffDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, setValue, watch, formState } = useForm<{ email: string; role: PlatformRole }>({ defaultValues: { role: "SUPPORT_AGENT" } });
  const role = watch("role");
  const [link, setLink] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (v: { email: string; role: PlatformRole }) => createPlatformStaffInvitation(v),
    onSuccess: (res) => {
      onDone();
      setLink(`${window.location.origin}/join-platform/${res.token}`);
      toast.success("تم إنشاء الدعوة");
    },
    onError: () => toast.error("تعذّر إنشاء الدعوة"),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>دعوة عضو جديد لفريق راصد</DialogTitle>
        </DialogHeader>
        {link ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-secondary">شارك هذا الرابط الآمن مع العضو. يُفتح مرة واحدة وينتهي خلال 7 أيام. لا يُنشأ كلمة مرور — يسجّل العضو دخوله بنفسه.</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-muted p-2">
              <span className="min-w-0 flex-1 truncate text-xs" dir="ltr">{link}</span>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => toast.success("تم النسخ"));
                }}
              >
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
            <Field label="البريد الإلكتروني" htmlFor="email" required error={formState.errors.email?.message}>
              <Input id="email" type="email" dir="ltr" {...register("email", { required: "البريد مطلوب" })} />
            </Field>
            <Field label="الدور" htmlFor="role" required>
              <Select value={role} onValueChange={(v) => setValue("role", v as PlatformRole)}>
                <SelectTrigger id="role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {PLATFORM_ROLE_LABEL[r] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <p className="text-xs text-text-tertiary">لن يحصل العضو على أي صلاحية قبل قبول الدعوة.</p>
            <DialogFooter>
              <Button type="submit" loading={mutation.isPending}>إنشاء رابط الدعوة</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
    onError: (e) => toast.error(isForbidden(e) ? "غير مسموح" : "تعذّر تنفيذ الإجراء"),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
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
