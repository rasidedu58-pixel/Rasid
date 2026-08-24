"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GroupMonth, EnrollmentPreviewResponse, FeeMethod } from "@academic-precision/contracts";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, formatMoney, toast } from "@academic-precision/ui";
import { Search } from "lucide-react";
import { fetchStudents } from "../../../../lib/api/students";
import { previewEnrollment, createEnrollment } from "../../../../lib/api/students";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { useDebounce } from "../../../../hooks/use-debounce";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Enroll an existing Student into this GroupMonth (POST
 * /group-months/:id/enrollments/preview + POST .../enrollments) — the last
 * step of Flow B (create month → group → schedule → student → guardian →
 * enroll). `groupMonth.joinFeePolicy` governs whether `feeMethod` is even
 * askable, mirroring `resolveFeeMethod` on the backend exactly: FULL/
 * REMAINING force their method (no picker shown), ASK_EVERY_TIME requires
 * the caller to choose — never a silent frontend default.
 */
export function EnrollStudentDialog({ groupMonth, open, onOpenChange }: { groupMonth: GroupMonth; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentName, setStudentName] = useState("");
  const [joinDate, setJoinDate] = useState(todayIso());
  const [feeMethod, setFeeMethod] = useState<FeeMethod>("FULL_MONTH");
  const [customFeeAmount, setCustomFeeAmount] = useState("");
  const [preview, setPreview] = useState<EnrollmentPreviewResponse | null>(null);

  const askFeeMethod = groupMonth.joinFeePolicy === "ASK_EVERY_TIME";

  const searchQuery = useQuery({
    queryKey: ["student-search", workspaceId, debouncedSearch],
    queryFn: () => fetchStudents(workspaceId!, { q: debouncedSearch, limit: 8 }),
    enabled: !!workspaceId && debouncedSearch.length > 0 && !studentId,
  });

  const previewMutation = useMutation({
    mutationFn: () =>
      previewEnrollment(workspaceId!, groupMonth.id, {
        studentId: studentId!,
        joinDate,
        feeMethod: askFeeMethod ? feeMethod : undefined,
        customFeeMinor: askFeeMethod && feeMethod === "CUSTOM" ? Math.round((Number(customFeeAmount) || 0) * 100) : undefined,
      }),
    onSuccess: setPreview,
    onError: () => toast.error("تعذّرت معاينة التسجيل"),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createEnrollment(workspaceId!, groupMonth.id, {
        studentId: studentId!,
        joinDate,
        feeMethod: askFeeMethod ? feeMethod : preview!.formula,
        customFeeMinor: askFeeMethod && feeMethod === "CUSTOM" ? Math.round((Number(customFeeAmount) || 0) * 100) : undefined,
        previewToken: preview!.previewToken,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.reports.group(workspaceId!, groupMonth.groupId) });
      toast.success("تم تسجيل الطالب");
      reset();
      onOpenChange(false);
    },
    onError: () => toast.error("تعذّر تسجيل الطالب — أعد المعاينة وحاول مرة أخرى"),
  });

  function reset() {
    setSearch("");
    setStudentId(null);
    setStudentName("");
    setJoinDate(todayIso());
    setFeeMethod("FULL_MONTH");
    setCustomFeeAmount("");
    setPreview(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تسجيل طالب في المجموعة</DialogTitle>
        </DialogHeader>

        {!studentId ? (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو كود الطالب..." className="ps-9" />
            </div>
            {searchQuery.data && searchQuery.data.items.length > 0 ? (
              <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                {searchQuery.data.items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setStudentId(s.id); setStudentName(s.name); }}
                    className="flex items-center justify-between px-3 py-2 text-start text-sm hover:bg-surface-sunken"
                  >
                    <span className="text-text-primary">{s.name}</span>
                    <span className="text-text-tertiary">{s.studentCode}</span>
                  </button>
                ))}
              </div>
            ) : debouncedSearch && !searchQuery.isLoading ? (
              <p className="text-xs text-text-tertiary">لا توجد نتائج مطابقة.</p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
              <span className="font-medium text-text-primary">{studentName}</span>
              <button type="button" onClick={() => { setStudentId(null); setPreview(null); }} className="text-xs text-brand hover:underline">
                تغيير
              </button>
            </div>

            <Field label="تاريخ الانضمام" htmlFor="joinDate">
              <Input id="joinDate" type="date" value={joinDate} onChange={(e) => { setJoinDate(e.target.value); setPreview(null); }} />
            </Field>

            {askFeeMethod ? (
              <>
                <Field label="طريقة احتساب الرسوم" htmlFor="feeMethod">
                  <Select value={feeMethod} onValueChange={(v) => { setFeeMethod(v as FeeMethod); setPreview(null); }}>
                    <SelectTrigger id="feeMethod"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL_MONTH">الرسوم الشهرية كاملة</SelectItem>
                      <SelectItem value="REMAINING_SESSIONS">حسب الحصص المتبقية</SelectItem>
                      <SelectItem value="CUSTOM">مبلغ مخصص</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {feeMethod === "CUSTOM" ? (
                  <Field label="المبلغ (جنيه)" htmlFor="customFee">
                    <Input id="customFee" type="number" min={0} value={customFeeAmount} onChange={(e) => { setCustomFeeAmount(e.target.value); setPreview(null); }} />
                  </Field>
                ) : null}
              </>
            ) : null}

            {preview ? (
              <div className="rounded-md border border-border bg-surface-sunken p-3 text-sm">
                <p className="text-text-secondary">المستحق: <span className="font-medium text-text-primary">{formatMoney(preview.calculatedDueMinor, preview.currency)}</span></p>
                {preview.eligibleSessions !== null ? <p className="text-xs text-text-tertiary">{preview.eligibleSessions} من {preview.totalBillableSessions} حصة متبقية محسوبة</p> : null}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {studentId ? (
            <>
              <Button variant="outline" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
                معاينة
              </Button>
              <Button disabled={!preview} loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
                تأكيد التسجيل
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
