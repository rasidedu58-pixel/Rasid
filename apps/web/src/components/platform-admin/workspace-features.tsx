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
  LoadingRegion,
  SectionCard,
  Textarea,
  formatDateTime,
  toast,
} from "@academic-precision/ui";
import { hasPlatformPermission, type WorkspaceFeature } from "@academic-precision/contracts";
import { qk } from "../../lib/query-keys";
import { useWorkspace } from "../../lib/workspace-provider";
import { fetchWorkspaceFeatures, revokeFeatureOverride, setFeatureOverride } from "../../lib/api/platform-operations";

/**
 * Customer 360 → "الميزات". Shows each override-able product feature with its
 * effective availability (global default + any workspace override). Owner /
 * Operations Admin (platform.features.manage) can enable, disable, or revoke an
 * override — reason mandatory, audited server-side. A feature override is NOT a
 * billing entitlement and NOT a security/RBAC bypass.
 */
export function WorkspaceFeatures({ workspaceId }: { workspaceId: string }) {
  const { platformRole } = useWorkspace();
  const canManage = hasPlatformPermission(platformRole, "platform.features.manage");
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.platformAdmin.workspaceFeatures(workspaceId), queryFn: () => fetchWorkspaceFeatures(workspaceId) });

  const [dialog, setDialog] = useState<null | { feature: WorkspaceFeature; state: "ENABLED" | "DISABLED" }>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.platformAdmin.workspaceFeatures(workspaceId) });

  const revoke = useMutation({
    mutationFn: (v: { featureKey: string; reason: string }) => revokeFeatureOverride(workspaceId, v),
    onSuccess: () => {
      invalidate();
      toast.success("تمت إعادة الميزة للوضع الافتراضي");
    },
    onError: () => toast.error("تعذّر إلغاء التجاوز"),
  });

  return (
    <SectionCard title="الميزات" description="إتاحة الميزات لهذا العميل: الافتراضي العام مع إمكان تجاوز خاص بهذه المساحة.">
      {query.isLoading ? (
        <LoadingRegion label="جارٍ تحميل الميزات…" />
      ) : query.isError ? (
        <p className="text-sm text-text-tertiary">تعذّر تحميل الميزات.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {(query.data?.items ?? []).map((f) => (
            <li key={f.key} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{f.label}</span>
                  <Badge tone={f.effectiveEnabled ? "success" : "neutral"}>{f.effectiveEnabled ? "مفعّلة" : "غير مفعّلة"}</Badge>
                  {f.override ? (
                    <Badge tone="info">تجاوز خاص بهذا العميل</Badge>
                  ) : (
                    <span className="text-xs text-text-tertiary">(الافتراضي العام)</span>
                  )}
                </div>
                <span className="text-xs text-text-tertiary">{f.description}</span>
                {f.override ? (
                  <span className="mt-1 text-xs text-text-tertiary">
                    السبب: {f.override.reason}
                    {f.override.expiresAt ? ` · ينتهي ${formatDateTime(f.override.expiresAt)}` : ""}
                    {f.override.createdByName ? ` · ${f.override.createdByName}` : ""}
                  </span>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  {f.effectiveEnabled ? (
                    <Button size="sm" variant="danger" onClick={() => setDialog({ feature: f, state: "DISABLED" })}>
                      تعطيل لهذا العميل
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setDialog({ feature: f, state: "ENABLED" })}>
                      تفعيل لهذا العميل
                    </Button>
                  )}
                  {f.override ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const reason = window.prompt("سبب إلغاء التجاوز (إلزامي):")?.trim();
                        if (reason) revoke.mutate({ featureKey: f.key, reason });
                      }}
                    >
                      إلغاء التجاوز
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {dialog ? (
        <OverrideDialog
          workspaceId={workspaceId}
          feature={dialog.feature}
          state={dialog.state}
          onClose={() => setDialog(null)}
          onDone={invalidate}
        />
      ) : null}
    </SectionCard>
  );
}

function OverrideDialog({
  workspaceId,
  feature,
  state,
  onClose,
  onDone,
}: {
  workspaceId: string;
  feature: WorkspaceFeature;
  state: "ENABLED" | "DISABLED";
  onClose: () => void;
  onDone: () => void;
}) {
  const { register, handleSubmit, formState } = useForm<{ reason: string; expiresAt?: string }>();
  const mutation = useMutation({
    mutationFn: (v: { reason: string; expiresAt?: string }) =>
      setFeatureOverride(workspaceId, {
        featureKey: feature.key as never,
        state,
        reason: v.reason,
        expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      onDone();
      toast.success("تم تطبيق التجاوز");
      onClose();
    },
    onError: () => toast.error("تعذّر تطبيق التجاوز"),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state === "ENABLED" ? "تفعيل" : "تعطيل"} «{feature.label}» لهذا العميل
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          <Field label="السبب" htmlFor="reason" required error={formState.errors.reason?.message}>
            <Textarea id="reason" rows={2} {...register("reason", { required: "السبب مطلوب" })} />
          </Field>
          <Field label="ينتهي في" htmlFor="expiresAt" hint="اختياري — اتركه فارغًا لتجاوز دائم">
            <Input id="expiresAt" type="datetime-local" dir="ltr" {...register("expiresAt")} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>تأكيد</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
