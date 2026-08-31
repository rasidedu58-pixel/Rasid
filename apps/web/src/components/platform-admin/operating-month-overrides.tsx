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
  formatDate,
  formatDateTime,
  toast,
} from "@academic-precision/ui";
import { hasPlatformPermission, type MonthOverrideType } from "@academic-precision/contracts";
import { CalendarCog } from "lucide-react";
import { qk } from "../../lib/query-keys";
import { useWorkspace } from "../../lib/workspace-provider";
import {
  createWorkspaceMonthOverride,
  fetchWorkspaceMonthOverrides,
  revokeMonthOverride,
} from "../../lib/api/platform-operations";
import { MONTH_OVERRIDE_TYPE_LABEL, monthOverrideTone } from "../../lib/platform-labels";

/**
 * Operating-Month Overrides for one customer (Customer 360). An OPERATIONAL
 * exception — it never grants an entitlement or extends a subscription. Gated by
 * platform.operating_months.manage (server enforces).
 */
export function OperatingMonthOverrides({ workspaceId }: { workspaceId: string }) {
  const { platformRole } = useWorkspace();
  const canManage = hasPlatformPermission(platformRole, "platform.operating_months.manage");
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: qk.platformAdmin.monthOverrides(workspaceId),
    queryFn: () => fetchWorkspaceMonthOverrides(workspaceId),
    enabled: canManage,
  });

  const revoke = useMutation({
    mutationFn: (overrideId: string) => revokeMonthOverride(overrideId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.platformAdmin.monthOverrides(workspaceId) });
      toast.success("تم سحب الاستثناء");
    },
    onError: () => toast.error("تعذّر سحب الاستثناء"),
  });

  if (!canManage) return null;

  const items = query.data?.items ?? [];
  const active = items.filter((o) => o.active);
  const history = items.filter((o) => !o.active);

  return (
    <SectionCard
      title="استثناءات الأشهر التشغيلية"
      description="سماح بالتحضير المبكر أو منع تحضير الأشهر — استثناء تشغيلي، لا يمنح اشتراكًا ولا يمدّده."
      action={
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <CalendarCog className="h-4 w-4" aria-hidden />
          منح استثناء
        </Button>
      }
    >
      {query.isLoading ? (
        <p className="text-sm text-text-tertiary">جارٍ التحميل…</p>
      ) : active.length === 0 && history.length === 0 ? (
        <p className="text-sm text-text-secondary">لا توجد استثناءات لهذه المساحة.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {active.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {active.map((o) => (
                <li key={o.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={monthOverrideTone(o.type)}>{MONTH_OVERRIDE_TYPE_LABEL[o.type] ?? o.type}</Badge>
                    <Badge tone="success">نشط</Badge>
                    <button type="button" onClick={() => revoke.mutate(o.id)} disabled={revoke.isPending} className="ms-auto text-xs text-text-tertiary hover:text-danger hover:underline disabled:opacity-50">
                      سحب
                    </button>
                  </div>
                  <p className="text-sm text-text-primary">{o.reason}</p>
                  <p className="text-xs text-text-tertiary">
                    {o.createdByName ? `أنشأه ${o.createdByName} · ` : ""}
                    {formatDateTime(o.createdAt)}
                    {o.expiresAt ? ` · ينتهي ${formatDate(o.expiresAt)}` : " · بلا انتهاء"}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}

          {history.length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-text-secondary">سجل سابق</p>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {history.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-xs text-text-tertiary">
                    <Badge tone="neutral">{MONTH_OVERRIDE_TYPE_LABEL[o.type] ?? o.type}</Badge>
                    <span className="truncate">{o.reason}</span>
                    <span className="ms-auto shrink-0">{o.revokedAt ? `سُحب ${formatDate(o.revokedAt)}` : o.expiresAt ? `انتهى ${formatDate(o.expiresAt)}` : "غير نشط"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <GrantOverrideDialog workspaceId={workspaceId} open={open} onOpenChange={setOpen} />
    </SectionCard>
  );
}

function GrantOverrideDialog({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, formState } = useForm<{ reason: string; expiresAt?: string }>();
  const [type, setType] = useState<MonthOverrideType>("EARLY_PREP_ALLOWED");

  const mutation = useMutation({
    mutationFn: (body: { type: MonthOverrideType; reason: string; expiresAt?: string }) => createWorkspaceMonthOverride(workspaceId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.platformAdmin.monthOverrides(workspaceId) });
      toast.success("تم منح الاستثناء");
      onOpenChange(false);
      reset();
      setType("EARLY_PREP_ALLOWED");
    },
    onError: () => toast.error("تعذّر منح الاستثناء"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>منح استثناء شهر تشغيلي</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((v) => mutation.mutate({ type, reason: v.reason, expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : undefined }))}
          className="flex flex-col gap-4"
        >
          <Field label="النوع" htmlFor="type">
            <Select value={type} onValueChange={(v) => setType(v as MonthOverrideType)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EARLY_PREP_ALLOWED">{MONTH_OVERRIDE_TYPE_LABEL.EARLY_PREP_ALLOWED}</SelectItem>
                <SelectItem value="PREP_BLOCKED">{MONTH_OVERRIDE_TYPE_LABEL.PREP_BLOCKED}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="السبب" htmlFor="reason" required error={formState.errors.reason?.message}>
            <Textarea id="reason" rows={3} placeholder="لماذا يُمنح هذا الاستثناء؟" {...register("reason", { required: "السبب مطلوب" })} />
          </Field>
          <Field label="تاريخ الانتهاء" htmlFor="expiresAt" hint="اختياري — بلا انتهاء إن تُرك فارغًا">
            <Input id="expiresAt" type="datetime-local" dir="ltr" {...register("expiresAt")} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>
              منح
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
