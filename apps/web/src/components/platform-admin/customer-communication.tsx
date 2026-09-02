"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  SectionCard,
  cn,
  formatDateTime,
  toast,
} from "@academic-precision/ui";
import { hasPlatformPermission } from "@academic-precision/contracts";
import { whatsappHref } from "../../lib/whatsapp";
import type {
  CreateFollowUpRequest,
  CreatePlatformContactLogRequest,
  FollowUp,
  PlatformContactChannel,
  PlatformContactDirection,
} from "@academic-precision/contracts";
import { CalendarClock, Copy, MessageCircle, MessageSquarePlus, Phone, Plus } from "lucide-react";
import { qk } from "../../lib/query-keys";
import { useWorkspace } from "../../lib/workspace-provider";
import {
  createWorkspaceContactLog,
  createWorkspaceFollowUp,
  fetchPlatformStaff,
  fetchWorkspaceContactLogs,
  fetchWorkspaceFollowUps,
  updateFollowUp,
} from "../../lib/api/platform-operations";
import {
  FOLLOW_UP_STATUS_LABEL,
  PLATFORM_CONTACT_CHANNEL_LABEL,
  PLATFORM_CONTACT_DIRECTION_LABEL,
  followUpStatusTone,
} from "../../lib/platform-labels";

/**
 * Unit 1 — Customer Communication + Follow-up, rendered inside Customer 360.
 * Write actions are gated by the caller's platform role (server still
 * enforces per-permission). Reads are visible to any allowlisted admin.
 */
export function CustomerCommunication({ workspaceId, ownerPhone }: { workspaceId: string; ownerPhone?: string | null }) {
  const { platformRole } = useWorkspace();
  const canView = hasPlatformPermission(platformRole, "platform.support.view");
  const canManage = hasPlatformPermission(platformRole, "platform.support.manage");
  const canLogContact = canManage;
  const canManageFollowUps = canManage;

  const [contactOpen, setContactOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);

  const logs = useQuery({
    queryKey: qk.platformAdmin.contactLogs(workspaceId),
    queryFn: () => fetchWorkspaceContactLogs(workspaceId),
    enabled: canView,
  });
  const followUps = useQuery({
    queryKey: qk.platformAdmin.workspaceFollowUps(workspaceId),
    queryFn: () => fetchWorkspaceFollowUps(workspaceId),
    enabled: canView,
  });

  // A staff member with no support access at all sees nothing here (UX only —
  // the server enforces the same on every endpoint).
  if (!canView) return null;

  const waLink = ownerPhone ? whatsappLink(ownerPhone) : null;

  return (
    <SectionCard
      title="التواصل والمتابعة"
      description="سجل مكالمات ورسائل هذا العميل، والمهام المجدولة لمتابعته."
    >
      {/* Quick actions */}
      {ownerPhone ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-tertiary">إجراءات سريعة:</span>
          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-sunken"
            >
              <MessageCircle className="h-3.5 w-3.5 text-success" aria-hidden />
              واتساب
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(ownerPhone).then(
                () => toast.success("تم نسخ الرقم"),
                () => toast.error("تعذّر النسخ"),
              );
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-sunken"
          >
            <Copy className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
            نسخ الرقم
            <span dir="ltr" className="text-text-tertiary">{ownerPhone}</span>
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Contact logs */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Phone className="h-4 w-4 text-text-tertiary" aria-hidden />
              سجل التواصل
            </h3>
            {canLogContact ? (
              <Button size="sm" variant="secondary" onClick={() => setContactOpen(true)}>
                <MessageSquarePlus className="h-4 w-4" aria-hidden />
                تسجيل تواصل
              </Button>
            ) : null}
          </div>
          {logs.isLoading ? (
            <p className="text-sm text-text-tertiary">جارٍ التحميل…</p>
          ) : logs.data && logs.data.items.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {logs.data.items.map((log) => (
                <li key={log.id} className="flex flex-col gap-1 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{PLATFORM_CONTACT_CHANNEL_LABEL[log.channel] ?? log.channel}</Badge>
                    <span className="text-xs text-text-tertiary">{PLATFORM_CONTACT_DIRECTION_LABEL[log.direction] ?? log.direction}</span>
                    <span className="ms-auto text-xs text-text-tertiary">{formatDateTime(log.occurredAt)}</span>
                  </div>
                  <p className="text-sm text-text-primary">{log.summary}</p>
                  {log.createdByName ? <p className="text-xs text-text-tertiary">بواسطة {log.createdByName}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-text-tertiary">لا يوجد تواصل مسجّل بعد.</p>
          )}
        </div>

        {/* Follow-ups */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <CalendarClock className="h-4 w-4 text-text-tertiary" aria-hidden />
              المتابعات
            </h3>
            {canManageFollowUps ? (
              <Button size="sm" variant="secondary" onClick={() => setFollowUpOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                متابعة جديدة
              </Button>
            ) : null}
          </div>
          {followUps.isLoading ? (
            <p className="text-sm text-text-tertiary">جارٍ التحميل…</p>
          ) : followUps.data && followUps.data.items.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {followUps.data.items.map((f) => (
                <FollowUpItem key={f.id} followUp={f} workspaceId={workspaceId} canManage={canManageFollowUps} />
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-text-tertiary">لا توجد متابعات.</p>
          )}
        </div>
      </div>

      {canLogContact ? <LogContactDialog workspaceId={workspaceId} open={contactOpen} onOpenChange={setContactOpen} /> : null}
      {canManageFollowUps ? <NewFollowUpDialog workspaceId={workspaceId} open={followUpOpen} onOpenChange={setFollowUpOpen} /> : null}
    </SectionCard>
  );
}

function FollowUpItem({ followUp, workspaceId, canManage }: { followUp: FollowUp; workspaceId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [rescheduling, setRescheduling] = useState(false);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.platformAdmin.workspaceFollowUps(workspaceId) });
    queryClient.invalidateQueries({ queryKey: qk.platformAdmin.followUpQueue() });
  };
  const statusMutation = useMutation({
    mutationFn: (status: "DONE" | "CANCELLED") => updateFollowUp(followUp.id, { status }),
    onSuccess: () => {
      invalidate();
      toast.success("تم تحديث المتابعة");
    },
    onError: () => toast.error("تعذّر تحديث المتابعة"),
  });
  const rescheduleMutation = useMutation({
    mutationFn: (dueAt: string) => updateFollowUp(followUp.id, { dueAt: new Date(dueAt).toISOString() }),
    onSuccess: () => {
      invalidate();
      setRescheduling(false);
      toast.success("تم تحديث موعد الاستحقاق");
    },
    onError: () => toast.error("تعذّر تحديث الموعد"),
  });
  const isPending = followUp.status === "PENDING";
  const overdue = isPending && followUp.dueAt ? new Date(followUp.dueAt).getTime() < Date.now() : false;
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Badge tone={followUpStatusTone(followUp.status)}>{FOLLOW_UP_STATUS_LABEL[followUp.status] ?? followUp.status}</Badge>
        <span className="text-sm font-medium text-text-primary">{followUp.title}</span>
        {followUp.dueAt ? (
          <span className={cn("ms-auto text-xs", overdue ? "font-medium text-danger" : "text-text-tertiary")}>
            {overdue ? "متأخرة · " : "تُستحق "}
            {formatDateTime(followUp.dueAt)}
          </span>
        ) : null}
      </div>
      {followUp.note ? <p className="text-sm text-text-secondary">{followUp.note}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
        {followUp.assignedToName ? <span>مُسندة إلى {followUp.assignedToName}</span> : <span>غير مُسندة</span>}
        {!isPending && followUp.resolvedByName ? <span>· أُغلقت بواسطة {followUp.resolvedByName}</span> : null}
        {canManage && isPending ? (
          <span className="ms-auto flex items-center gap-2.5">
            <button type="button" onClick={() => statusMutation.mutate("DONE")} disabled={statusMutation.isPending} className="font-medium text-brand hover:underline disabled:opacity-50">
              تمّت
            </button>
            <button type="button" onClick={() => setRescheduling((v) => !v)} className="text-text-tertiary hover:text-text-primary hover:underline">
              تأجيل
            </button>
            <button type="button" onClick={() => statusMutation.mutate("CANCELLED")} disabled={statusMutation.isPending} className="text-text-tertiary hover:text-danger hover:underline disabled:opacity-50">
              إلغاء
            </button>
          </span>
        ) : null}
      </div>
      {rescheduling && canManage && isPending ? (
        <div className="mt-1 flex items-center gap-2">
          <Input
            type="datetime-local"
            dir="ltr"
            className="h-8 max-w-[210px] text-xs"
            onChange={(e) => {
              if (e.target.value) rescheduleMutation.mutate(e.target.value);
            }}
          />
          <span className="text-xs text-text-tertiary">اختر موعدًا جديدًا</span>
        </div>
      ) : null}
    </li>
  );
}

function LogContactDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState } = useForm<{ summary: string; occurredAt?: string }>();
  const [channel, setChannel] = useState<PlatformContactChannel>("CALL");
  const [direction, setDirection] = useState<PlatformContactDirection>("OUTBOUND");

  const mutation = useMutation({
    mutationFn: (body: CreatePlatformContactLogRequest) => createWorkspaceContactLog(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.platformAdmin.contactLogs(workspaceId) });
      toast.success("تم تسجيل التواصل");
      onOpenChange(false);
      reset();
      setChannel("CALL");
      setDirection("OUTBOUND");
    },
    onError: () => toast.error("تعذّر تسجيل التواصل"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل تواصل مع العميل</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((v) =>
            mutation.mutate({ channel, direction, summary: v.summary, occurredAt: v.occurredAt ? new Date(v.occurredAt).toISOString() : undefined }),
          )}
          className="flex flex-col gap-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="القناة" htmlFor="channel">
              <Select value={channel} onValueChange={(v) => setChannel(v as PlatformContactChannel)}>
                <SelectTrigger id="channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PLATFORM_CONTACT_CHANNEL_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="الاتجاه" htmlFor="direction">
              <Select value={direction} onValueChange={(v) => setDirection(v as PlatformContactDirection)}>
                <SelectTrigger id="direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PLATFORM_CONTACT_DIRECTION_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="وقت التواصل" htmlFor="occurredAt" hint="اختياري — الافتراضي الآن">
            <Input id="occurredAt" type="datetime-local" dir="ltr" {...register("occurredAt")} />
          </Field>
          <Field label="الملخص" htmlFor="summary" required error={formState.errors.summary?.message}>
            <Textarea id="summary" rows={4} placeholder="ماذا دار في التواصل؟" {...register("summary", { required: "الملخص مطلوب" })} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>
              حفظ
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewFollowUpDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState } = useForm<{ title: string; note?: string; dueAt?: string }>();
  const [assignee, setAssignee] = useState<string>("UNASSIGNED");
  const staff = useQuery({ queryKey: qk.platformAdmin.staff(), queryFn: fetchPlatformStaff, enabled: open });

  const mutation = useMutation({
    mutationFn: (body: CreateFollowUpRequest) => createWorkspaceFollowUp(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.platformAdmin.workspaceFollowUps(workspaceId) });
      queryClient.invalidateQueries({ queryKey: qk.platformAdmin.followUpQueue() });
      toast.success("تمت إضافة المتابعة");
      onOpenChange(false);
      reset();
      setAssignee("UNASSIGNED");
    },
    onError: () => toast.error("تعذّر إضافة المتابعة"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>متابعة جديدة</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((v) =>
            mutation.mutate({
              title: v.title,
              note: v.note || undefined,
              dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : undefined,
              assignedToUserId: assignee !== "UNASSIGNED" ? assignee : undefined,
            }),
          )}
          className="flex flex-col gap-4"
        >
          <Field label="العنوان" htmlFor="title" required error={formState.errors.title?.message}>
            <Input id="title" placeholder="مثال: متابعة تجديد الاشتراك" {...register("title", { required: "العنوان مطلوب" })} />
          </Field>
          <Field label="ملاحظة" htmlFor="note" hint="اختياري">
            <Textarea id="note" rows={3} {...register("note")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="تاريخ الاستحقاق" htmlFor="dueAt" hint="اختياري">
              <Input id="dueAt" type="datetime-local" dir="ltr" {...register("dueAt")} />
            </Field>
            <Field label="الإسناد" htmlFor="assignee">
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger id="assignee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UNASSIGNED">غير مُسندة</SelectItem>
                  {(staff.data?.items ?? []).map((s) => (
                    <SelectItem key={s.userId} value={s.userId}>
                      {s.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>
              إضافة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delegates to the shared wa.me builder (single source of truth for the
 *  Egyptian 0-prefix → +20 normalization). */
function whatsappLink(phone: string): string | null {
  return whatsappHref(phone);
}
