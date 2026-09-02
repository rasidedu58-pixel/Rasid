"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PermissionDeniedState,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  formatMoney,
  toast,
} from "@academic-precision/ui";
import { hasPlatformPermission, type PlatformCustomRequestDto } from "@academic-precision/contracts";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { createCustomOffer, fetchPlatformCustomRequests } from "../../../lib/api/platform-admin";
import { isForbidden } from "../../../lib/api/client";

const STATUS_LABEL: Record<string, string> = { PENDING_REVIEW: "قيد المراجعة", OFFERED: "عُرض", CANCELLED: "ملغى", CLOSED: "مغلق" };

export default function PlatformCustomPlansPage() {
  const { platformRole } = useWorkspace();
  const canManage = hasPlatformPermission(platformRole, "platform.billing.manage");
  const [offerTarget, setOfferTarget] = useState<PlatformCustomRequestDto | null>(null);
  const query = useQuery({ queryKey: ["platform-admin", "custom-requests"], queryFn: () => fetchPlatformCustomRequests(), retry: (n, e) => !isForbidden(e) && n < 2 });

  if (isForbidden(query.error)) return <PermissionDeniedState />;
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader title="الباقات المخصصة" description="طلبات وعروض الباقات المخصصة (أكثر من 3000 طالب). التوصية داخلية فقط." />
      {query.isLoading ? (
        <SkeletonRows rows={6} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-6 w-6" />} title="لا توجد طلبات باقات مخصصة" />
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>المطلوب</TableHead>
                <TableHead>التوصية الداخلية</TableHead>
                <TableHead>الدورة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.customerName ?? r.workspaceName ?? "—"}</TableCell>
                  <TableCell>{r.requestedMaxActiveStudents} طالب · {r.requestedMaxTeamMembers} فريق</TableCell>
                  <TableCell>
                    {formatMoney(r.recommendedPriceMinor)} <span className="text-xs text-text-tertiary">(v{r.recommendationVersion})</span>
                  </TableCell>
                  <TableCell>{r.preferredBillingCycle === "ANNUAL" ? "سنوي" : "شهري"}</TableCell>
                  <TableCell><Badge tone={r.status === "PENDING_REVIEW" ? "warning" : "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                  <TableCell>
                    {canManage && (r.status === "PENDING_REVIEW" || r.status === "OFFERED") ? (
                      <Button size="sm" onClick={() => setOfferTarget(r)}>{r.status === "OFFERED" ? "عرض جديد" : "إنشاء عرض"}</Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
      {offerTarget ? <OfferDialog request={offerTarget} onClose={() => setOfferTarget(null)} onDone={() => query.refetch()} /> : null}
    </>
  );
}

function OfferDialog({ request, onClose, onDone }: { request: PlatformCustomRequestDto; onClose: () => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, watch } = useForm({
    defaultValues: {
      maxActiveStudents: request.requestedMaxActiveStudents,
      maxTeamMembers: Math.max(request.requestedMaxTeamMembers, request.recommendedMaxTeamMembers),
      // Entered/displayed in EGP (pounds) for consistency with the ج.م recommendation
      // shown above; converted to the stored piastre `priceMinor` on submit.
      priceEgp: request.recommendedPriceMinor / 100,
      adjustmentReason: "",
      effectiveMode: "IMMEDIATE" as const,
      validForDays: 14,
    },
  });
  const priceMinor = Math.round(Number(watch("priceEgp")) * 100);
  const differs = priceMinor !== request.recommendedPriceMinor;

  const mutation = useMutation({
    mutationFn: (v: Record<string, unknown>) =>
      createCustomOffer({
        customRequestId: request.id,
        maxActiveStudents: Number(v.maxActiveStudents),
        maxTeamMembers: Number(v.maxTeamMembers),
        billingCycle: "MONTHLY" as never, // V1 MONTHLY-only
        priceMinor: Math.round(Number(v.priceEgp) * 100),
        adjustmentReason: (v.adjustmentReason as string) || undefined,
        effectiveMode: v.effectiveMode as never,
        validForDays: Number(v.validForDays),
      }),
    onSuccess: () => { toast.success("تم إرسال العرض للعميل."); queryClient.invalidateQueries({ queryKey: ["platform-admin", "custom-requests"] }); onDone(); onClose(); },
    onError: () => toast.error("تعذّر إنشاء العرض (سبب التعديل مطلوب عند اختلاف السعر عن التوصية)."),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>عرض باقة مخصصة — {request.workspaceName ?? request.customerName}</DialogTitle></DialogHeader>
        <p className="text-sm text-text-secondary">التوصية الداخلية: {formatMoney(request.recommendedPriceMinor)} · {request.recommendedMaxTeamMembers} مقعد فريق</p>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="حد الطلاب" htmlFor="maxActiveStudents"><Input id="maxActiveStudents" type="number" min={3001} {...register("maxActiveStudents")} /></Field>
            <Field label="حد الفريق" htmlFor="maxTeamMembers"><Input id="maxTeamMembers" type="number" min={0} {...register("maxTeamMembers")} /></Field>
            <Field label="السعر (جنيه)" htmlFor="priceEgp"><Input id="priceEgp" type="number" min={1} step="0.01" {...register("priceEgp")} /></Field>
            <Field label="صلاحية (أيام)" htmlFor="validForDays"><Input id="validForDays" type="number" min={1} max={90} {...register("validForDays")} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الدورة" htmlFor="billingCycleDisplay">
              <input id="billingCycleDisplay" className="h-9 rounded-md border border-border bg-surface-sunken px-2 text-sm text-text-secondary" value="شهري" disabled readOnly />
            </Field>
            <Field label="التطبيق" htmlFor="effectiveMode">
              <select id="effectiveMode" className="h-9 rounded-md border border-border bg-surface px-2 text-sm" {...register("effectiveMode")}>
                <option value="IMMEDIATE">فوري بعد الدفع</option>
                <option value="NEXT_RENEWAL">عند التجديد القادم</option>
              </select>
            </Field>
          </div>
          {differs ? <Field label="سبب اختلاف السعر عن التوصية (إلزامي)" htmlFor="adjustmentReason"><Input id="adjustmentReason" {...register("adjustmentReason")} /></Field> : null}
          <DialogFooter><Button type="submit" loading={mutation.isPending}>إرسال العرض</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
