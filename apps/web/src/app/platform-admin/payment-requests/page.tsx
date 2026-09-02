"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import {
  Badge,
  Button,
  CursorPagination,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Field,
  PermissionDeniedState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  Textarea,
  formatDate,
  formatMoney,
  toast,
} from "@academic-precision/ui";
import { hasPlatformPermission, type PlatformPaymentRequestDto } from "@academic-precision/contracts";
import { whatsappHref } from "../../../lib/whatsapp";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { fetchPlatformPaymentRequests, confirmPaymentRequest, rejectPaymentRequest } from "../../../lib/api/platform-admin";
import { isForbidden } from "../../../lib/api/client";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  CONFIRMED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};
const STATUS_LABEL: Record<string, string> = { PENDING: "بانتظار", CONFIRMED: "مؤكَّد", REJECTED: "مرفوض", CANCELLED: "ملغى", EXPIRED: "منتهي" };
const METHOD_LABEL: Record<string, string> = { INSTAPAY: "إنستاباي", VODAFONE_CASH: "فودافون كاش" };

const customerWhatsapp = (phone: string | null): string | null => whatsappHref(phone);

export default function PlatformAdminPaymentRequestsPage() {
  const { platformRole } = useWorkspace();
  const canManage = hasPlatformPermission(platformRole, "platform.billing.manage");
  const [status, setStatus] = useState<string | undefined>("PENDING");
  const [rejectTarget, setRejectTarget] = useState<PlatformPaymentRequestDto | null>(null);
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ["platform-admin", "payment-requests", status],
    queryFn: ({ pageParam }: { pageParam?: string }) => fetchPlatformPaymentRequests({ status, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["platform-admin", "payment-requests"] });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmPaymentRequest(id),
    onSuccess: () => { invalidate(); toast.success("تم تأكيد الدفع وتفعيل الاشتراك"); },
    onError: () => toast.error("تعذّر تأكيد الدفع"),
  });

  if (isForbidden(query.error)) return <PermissionDeniedState />;

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const hasNext = query.data?.pages[query.data.pages.length - 1]?.page.hasNext ?? false;

  return (
    <>
      <PageHeader title="طلبات الدفع" description="مراجعة وتأكيد المدفوعات اليدوية (إنستاباي / فودافون كاش)." />

      <div className="mb-4 w-48">
        <Select value={status ?? "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? undefined : v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">كل الحالات</SelectItem>
            <SelectItem value="PENDING">بانتظار</SelectItem>
            <SelectItem value="CONFIRMED">مؤكَّد</SelectItem>
            <SelectItem value="REJECTED">مرفوض</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={8} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Receipt className="h-6 w-6" />} title="لا توجد طلبات دفع" />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العميل</TableHead>
                  <TableHead>الكود</TableHead>
                  <TableHead>الباقة</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>الطريقة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => {
                  const wa = customerWhatsapp(r.customerPhone);
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-text-primary">{r.customerName ?? r.workspaceName ?? "—"}</span>
                          <span className="text-xs text-text-tertiary">{r.customerPhone ?? ""}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">{r.humanCode}</TableCell>
                      <TableCell>
                        {r.targetPlanCode === "CUSTOM" ? (
                          <div className="flex flex-col">
                            <span>مخصصة{r.offerVersion ? ` (v${r.offerVersion})` : ""}</span>
                            <span className="text-xs text-brand">
                              {r.customMaxActiveStudents ?? "؟"} طالب · {r.customMaxTeamMembers ?? "؟"} فريق · {r.actionType === "UPGRADE" ? "ترقية" : r.actionType === "RENEWAL" ? "تجديد" : "جديد"}
                            </span>
                          </div>
                        ) : r.actionType === "UPGRADE" && r.currentPlanCode ? (
                          <div className="flex flex-col">
                            <span>{r.currentPlanCode} ← {r.targetPlanCode}</span>
                            <span className="text-xs text-brand">ترقية · {r.billingCycle === "ANNUAL" ? "سنوي" : "شهري"}</span>
                          </div>
                        ) : (
                          <>{r.targetPlanCode} · {r.billingCycle === "ANNUAL" ? "سنوي" : "شهري"}</>
                        )}
                      </TableCell>
                      <TableCell>
                        {formatMoney(r.amountMinor, r.currencyCode)}
                        {r.actionType === "UPGRADE" ? <span className="block text-xs text-text-tertiary">فرق الترقية</span> : null}
                      </TableCell>
                      <TableCell>{METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod}</TableCell>
                      <TableCell>{formatDate(r.createdAt)}</TableCell>
                      <TableCell><Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {wa ? (
                            <Button asChild variant="ghost" size="sm"><a href={wa} target="_blank" rel="noopener noreferrer">واتساب</a></Button>
                          ) : null}
                          {canManage && r.status === "PENDING" ? (
                            <>
                              <Button size="sm" loading={confirmMutation.isPending && confirmMutation.variables === r.id} onClick={() => confirmMutation.mutate(r.id)}>تأكيد</Button>
                              <Button size="sm" variant="outline" onClick={() => setRejectTarget(r)}>رفض</Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
          <CursorPagination hasMore={hasNext} loading={query.isFetchingNextPage} loadedCount={items.length} onLoadMore={() => query.fetchNextPage()} />
        </>
      )}

      {rejectTarget ? (
        <RejectDialog target={rejectTarget} onClose={() => setRejectTarget(null)} onDone={invalidate} />
      ) : null}
    </>
  );
}

function RejectDialog({ target, onClose, onDone }: { target: PlatformPaymentRequestDto; onClose: () => void; onDone: () => void }) {
  const { register, handleSubmit, formState } = useForm<{ reason: string }>();
  const mutation = useMutation({
    mutationFn: (v: { reason: string }) => rejectPaymentRequest(target.id, { reason: v.reason }),
    onSuccess: () => { onDone(); toast.success("تم رفض الطلب"); onClose(); },
    onError: () => toast.error("تعذّر رفض الطلب"),
  });
  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : null)}>
      <DialogContent>
        <DialogHeader><DialogTitle>رفض طلب الدفع {target.humanCode}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          <Field label="سبب الرفض" htmlFor="reason" required error={formState.errors.reason?.message}>
            <Textarea id="reason" rows={3} {...register("reason", { required: "السبب مطلوب" })} />
          </Field>
          <DialogFooter><Button type="submit" variant="danger" loading={mutation.isPending}>تأكيد الرفض</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
