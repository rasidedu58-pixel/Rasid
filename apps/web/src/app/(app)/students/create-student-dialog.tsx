"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Plus, Trash2, UserPlus } from "lucide-react";
import type { FeeMethod } from "@academic-precision/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@academic-precision/ui";
import { createStudent, previewStudentMatch } from "../../../lib/api/students";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";
import { GroupPicker } from "../../../components/enrollment/group-picker";
import { useCurrentGroupMonth } from "../../../lib/use-current-group-month";
import { enrollStudentIntoGroupMonth, todayIso } from "../../../lib/enroll-student";
import { invalidateAfterEnrollment } from "../../../lib/invalidate-enrollment";

interface GuardianRow {
  name: string;
  phone: string;
}
interface Candidate {
  studentId: string;
  name: string;
  studentCode: string;
}

const emptyGuardian = (): GuardianRow => ({ name: "", phone: "" });

/**
 * Fast student add: student name + guardian(s), a "save and add another" flow
 * for entering many students quickly, the duplicate-candidate gate
 * (match-preview), AND optional one-step enrollment into a group (§Flow A).
 * Enrollment is anchored to the group's CURRENT-month GroupMonth (resolved via
 * `useCurrentGroupMonth`) — the student is created first, then enrolled; if the
 * enroll step fails, the student is NOT lost (recovery: "إعادة محاولة التسجيل").
 *
 * NOTE: school / grade / date-of-birth / notes / photo are NOT modeled in the
 * students schema today, so they are intentionally omitted here rather than
 * shown as fields that cannot be saved (flagged as a Product/schema addition).
 */
export function CreateStudentDialog() {
  const router = useRouter();
  const { workspaceId, canWrite } = useWorkspace();
  const queryClient = useQueryClient();
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [guardians, setGuardians] = useState<GuardianRow[]>([emptyGuardian()]);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [ackDuplicates, setAckDuplicates] = useState(false);
  const [addAnotherMode, setAddAnotherMode] = useState(false);

  // Enrollment section
  const [groupId, setGroupId] = useState<string | null>(null);
  const [feeMethod, setFeeMethod] = useState<FeeMethod>("FULL_MONTH");
  const [pendingEnrollId, setPendingEnrollId] = useState<string | null>(null); // created but enroll failed
  const { state: gmState, isLoading: gmLoading } = useCurrentGroupMonth(groupId);
  const groupReady = gmState.status === "READY";
  const askFee = groupReady && gmState.groupMonth.joinFeePolicy === "ASK_EVERY_TIME";

  function resetForm(keepGroup = false) {
    setName("");
    setGuardians([emptyGuardian()]);
    setCandidates(null);
    setAckDuplicates(false);
    setPendingEnrollId(null);
    if (!keepGroup) {
      setGroupId(null);
      setFeeMethod("FULL_MONTH");
    }
  }
  function invalidateDuplicateGate() {
    setCandidates(null);
    setAckDuplicates(false);
  }

  const primaryPhone = guardians.find((g) => g.phone.trim())?.phone.trim();
  const guardianError = guardians.some((g) => g.name.trim() && !g.phone.trim());
  const canSubmit = name.trim().length > 0 && !guardianError;

  const preview = useMutation({
    mutationFn: () => previewStudentMatch(workspaceId!, { name: name.trim(), guardianPhone: primaryPhone }),
  });

  const create = useMutation({
    mutationFn: () => {
      const payload = guardians
        .filter((g) => g.phone.trim())
        .map((g, i) => ({ name: g.name.trim() || undefined, phone: g.phone.trim(), relationship: "guardian", isPrimary: i === 0 }));
      return createStudent(workspaceId!, { name: name.trim(), guardians: payload.length > 0 ? payload : undefined });
    },
  });

  /** Enroll an existing student (from the duplicate-candidate list) into the chosen group. */
  async function enrollExistingCandidate(studentId: string) {
    if (!groupReady) return;
    try {
      await enrollStudentIntoGroupMonth(workspaceId!, gmState.groupMonth, {
        studentId,
        joinDate: todayIso(),
        feeMethod: askFee ? feeMethod : undefined,
      });
      invalidateAfterEnrollment(queryClient, workspaceId!, { studentId, groupId: groupId! });
      toast.success("تم تسجيل الطالب الموجود في المجموعة");
      setOpen(false);
      resetForm();
      router.push(`/students/${studentId}`);
    } catch {
      toast.error("تعذّر تسجيل هذا الطالب في المجموعة");
    }
  }

  async function submit(addAnother: boolean) {
    if (!canSubmit) return;
    setAddAnotherMode(addAnother);

    // Recovery: student already created, only the enroll step failed before.
    if (pendingEnrollId) {
      if (!groupReady) {
        toast.error("المجموعة غير جاهزة للتسجيل الآن.");
        return;
      }
      try {
        await enrollStudentIntoGroupMonth(workspaceId!, gmState.groupMonth, {
          studentId: pendingEnrollId,
          joinDate: todayIso(),
          feeMethod: askFee ? feeMethod : undefined,
        });
      } catch {
        toast.error("تعذّر تسجيل الطالب في المجموعة، حاول مجددًا");
        return;
      }
      invalidateAfterEnrollment(queryClient, workspaceId!, { studentId: pendingEnrollId, groupId: groupId! });
      toast.success("تم تسجيل الطالب في المجموعة");
      finishAfterSuccess(pendingEnrollId, addAnother);
      return;
    }

    // Duplicate gate: preview once; if candidates surface, require a second press.
    if (!ackDuplicates) {
      const result = await preview.mutateAsync();
      if (result.candidates.length > 0) {
        setCandidates(result.candidates);
        setAckDuplicates(true);
        return;
      }
    }

    const res = await create.mutateAsync();
    const studentId = res.student.id;

    // Optional enroll step — the student is already saved; never lose them.
    if (groupReady) {
      try {
        await enrollStudentIntoGroupMonth(workspaceId!, gmState.groupMonth, {
          studentId,
          joinDate: todayIso(),
          feeMethod: askFee ? feeMethod : undefined,
        });
      } catch {
        setPendingEnrollId(studentId);
        queryClient.invalidateQueries({ queryKey: qk.students.list(workspaceId!) });
        toast.warning("تم حفظ الطالب، لكن تعذّر تسجيله في المجموعة. أعد المحاولة.");
        return;
      }
      invalidateAfterEnrollment(queryClient, workspaceId!, { studentId, groupId: groupId! });
      toast.success("تمت إضافة الطالب وتسجيله في المجموعة");
    } else {
      queryClient.invalidateQueries({ queryKey: qk.students.list(workspaceId!) });
      toast.success("تم إضافة الطالب");
    }
    finishAfterSuccess(studentId, addAnother);
  }

  function finishAfterSuccess(studentId: string, addAnother: boolean) {
    if (addAnother) {
      resetForm(true); // keep the group so several students go to the same group fast
      nameRef.current?.focus();
    } else {
      setOpen(false);
      resetForm();
      router.push(`/students/${studentId}`);
    }
  }

  if (!canWrite("CORE_OPERATIONS")) return null;

  const busy = preview.isPending || create.isPending;
  const acted = candidates && candidates.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" aria-hidden />
          طالب جديد
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة طالب</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
          className="flex flex-col gap-4"
        >
          <Field label="اسم الطالب" htmlFor="name" required>
            <Input
              id="name"
              ref={nameRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                invalidateDuplicateGate();
                setPendingEnrollId(null);
              }}
              autoFocus
            />
          </Field>

          {/* Guardians — first with a phone is the primary contact */}
          <div className="flex flex-col gap-3">
            {guardians.map((g, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary">{i === 0 ? "ولي الأمر" : `ولي أمر إضافي ${new Intl.NumberFormat("ar-EG").format(i)}`}</span>
                  {i > 0 ? (
                    <button type="button" onClick={() => setGuardians((p) => p.filter((_, j) => j !== i))} className="text-danger" aria-label="حذف">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    placeholder="الاسم (اختياري)"
                    value={g.name}
                    onChange={(e) => {
                      setGuardians((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)));
                      invalidateDuplicateGate();
                    }}
                  />
                  <Input
                    dir="ltr"
                    inputMode="tel"
                    placeholder="رقم الهاتف"
                    value={g.phone}
                    onChange={(e) => {
                      setGuardians((p) => p.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)));
                      invalidateDuplicateGate();
                    }}
                  />
                </div>
                {g.name.trim() && !g.phone.trim() ? <p className="text-xs text-danger">أدخل رقم هاتف لولي الأمر أو احذف الاسم.</p> : null}
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setGuardians((p) => [...p, emptyGuardian()])}>
              <UserPlus className="h-4 w-4" aria-hidden />
              ولي أمر آخر
            </Button>
          </div>

          {/* Enrollment section (§Flow A) */}
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-sunken p-3">
            <span className="text-xs font-medium text-text-secondary">التسجيل في مجموعة</span>
            <GroupPicker value={groupId} onChange={(id) => { setGroupId(id); setPendingEnrollId(null); }} />
            {groupId === null ? (
              <p className="text-xs text-text-tertiary">يمكنك تسجيل الطالب في مجموعة الآن أو تركه بدون مجموعة وإضافته لاحقًا.</p>
            ) : gmLoading ? (
              <p className="text-xs text-text-tertiary">جارٍ التحقق من تجهيز المجموعة…</p>
            ) : gmState.status === "NOT_PREPARED" ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-subtle p-2 text-xs text-text-secondary">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <span>
                  هذه المجموعة غير مُضمّنة في الشهر التشغيلي الحالي، فلا يمكن التسجيل فيها بعد.{" "}
                  <button type="button" className="font-medium text-brand hover:underline" onClick={() => setGroupId(null)}>اختيار مجموعة أخرى</button>
                  {" "}أو تضمينها من{" "}
                  <Link href="/months" className="font-medium text-brand hover:underline" onClick={() => setOpen(false)}>الأشهر التشغيلية</Link>.
                </span>
              </div>
            ) : gmState.status === "NO_CURRENT_MONTH" ? (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-subtle p-2 text-xs text-text-secondary">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <span>لا يوجد شهر تشغيلي حالي. سيُحفظ الطالب بدون تسجيل.</span>
              </div>
            ) : askFee ? (
              <Field label="طريقة احتساب الرسوم" htmlFor="feeMethod-a">
                <Select value={feeMethod} onValueChange={(v) => setFeeMethod(v as FeeMethod)}>
                  <SelectTrigger id="feeMethod-a"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_MONTH">الرسوم الشهرية كاملة</SelectItem>
                    <SelectItem value="REMAINING_SESSIONS">حسب الحصص المتبقية</SelectItem>
                    <SelectItem value="CUSTOM">مبلغ مخصص</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
          </div>

          {acted ? (
            <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-subtle p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                قد يكون هذا الطالب موجودًا بالفعل
              </div>
              <ul className="flex flex-col gap-1.5 text-sm text-text-secondary">
                {candidates!.map((c) => (
                  <li key={c.studentId} className="flex items-center justify-between gap-2">
                    <button type="button" className="text-brand hover:underline" onClick={() => { setOpen(false); router.push(`/students/${c.studentId}`); }}>
                      {c.name} — {c.studentCode}
                    </button>
                    {groupReady ? (
                      <button type="button" className="shrink-0 text-xs font-medium text-brand hover:underline" onClick={() => void enrollExistingCandidate(c.studentId)}>
                        سجّل هذا الطالب في المجموعة
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-tertiary">راجع القائمة، ثم أكمل الحفظ إذا كان طالبًا مختلفًا فعلًا.</p>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            {pendingEnrollId ? (
              <Button type="button" variant="outline" onClick={() => { setOpen(false); resetForm(); router.push(`/students/${pendingEnrollId}`); }}>
                فتح ملف الطالب
              </Button>
            ) : (
              <Button type="button" variant="outline" loading={busy && addAnotherMode} disabled={!canSubmit} onClick={() => void submit(true)}>
                {acted ? "حفظ على أي حال وإضافة آخر" : "حفظ وإضافة آخر"}
              </Button>
            )}
            <Button type="submit" loading={busy && !addAnotherMode} disabled={!canSubmit}>
              {pendingEnrollId ? "إعادة محاولة التسجيل" : acted ? "حفظ على أي حال" : groupReady ? "حفظ وتسجيل" : "حفظ"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
