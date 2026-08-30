"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FeeMethod, GroupMonth } from "@academic-precision/contracts";
import { AlertTriangle, CalendarClock, Check, RotateCcw, Search, UserPlus } from "lucide-react";
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
  toast,
} from "@academic-precision/ui";
import { fetchStudents, createStudent, previewStudentMatch, batchEnrollStudents } from "../../lib/api/students";
import { fetchGroupReport } from "../../lib/api/reports";
import { qk } from "../../lib/query-keys";
import { useWorkspace } from "../../lib/workspace-provider";
import { useDebounce } from "../../hooks/use-debounce";
import { useCurrentGroupMonth } from "../../lib/use-current-group-month";
import { enrollStudentIntoGroupMonth, todayIso } from "../../lib/enroll-student";
import { invalidateAfterEnrollment } from "../../lib/invalidate-enrollment";

/**
 * Flow B — "إضافة طلاب إلى المجموعة". A side sheet (not a full page) with two
 * tabs: enroll several EXISTING students at once (bulk), or add a brand-new
 * student who is created and enrolled in one step. Both operate on the group's
 * CURRENT-month GroupMonth (resolved via `useCurrentGroupMonth`); if the group
 * isn't attached to a current month, the sheet shows the exact blocking state
 * instead of failing silently.
 */
export function AddStudentsToGroupSheet({
  group,
  open,
  onOpenChange,
}: {
  group: { id: string; name: string };
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { state, isLoading } = useCurrentGroupMonth(open ? group.id : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="w-full gap-4 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>إضافة طلاب إلى {group.name}</SheetTitle>
          <SheetDescription>سجّل طلابًا موجودين دفعة واحدة، أو أضف طالبًا جديدًا وسجّله مباشرة.</SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : state.status === "NO_CURRENT_MONTH" ? (
          <BlockingState
            icon={<CalendarClock className="h-5 w-5 text-warning" aria-hidden />}
            title="لا يوجد شهر تشغيلي حالي"
            body="أنشئ شهرًا تشغيليًا حاليًا أولًا حتى تتمكن من تسجيل الطلاب."
            cta={<Link href="/months" className="text-sm font-medium text-brand hover:underline">إدارة الأشهر التشغيلية</Link>}
          />
        ) : state.status === "NOT_PREPARED" ? (
          <BlockingState
            icon={<CalendarClock className="h-5 w-5 text-warning" aria-hidden />}
            title="هذه المجموعة غير مُضمّنة في الشهر الحالي"
            body="لتسجيل الطلاب، يجب أولًا تضمين المجموعة في الشهر التشغيلي الحالي مع رسومها وجدولها. يتم ذلك عند تجهيز الشهر التشغيلي من صفحة الأشهر."
            cta={<Link href="/months" className="text-sm font-medium text-brand hover:underline">إدارة الأشهر التشغيلية</Link>}
          />
        ) : state.status === "READY" ? (
          <Tabs defaultValue="existing" className="flex flex-col gap-4">
            <TabsList className="w-full">
              <TabsTrigger value="existing" className="flex-1">طلاب موجودون</TabsTrigger>
              <TabsTrigger value="new" className="flex-1">طالب جديد</TabsTrigger>
            </TabsList>
            <TabsContent value="existing">
              <ExistingStudentsTab group={group} groupMonth={state.groupMonth} onDone={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="new">
              <NewStudentTab group={group} groupMonth={state.groupMonth} />
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function BlockingState({ icon, title, body, cta }: { icon: React.ReactNode; title: string; body: string; cta: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface-sunken px-6 py-10 text-center">
      {icon}
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="max-w-xs text-sm text-text-secondary">{body}</p>
      <div className="mt-1">{cta}</div>
    </div>
  );
}

/** Compact fee-method picker — only rendered for ASK_EVERY_TIME groups (mirrors the single-enroll dialog and the backend `resolveFeeMethod`). */
function FeeMethodField({ groupMonth, value, onChange, allowCustom }: { groupMonth: GroupMonth; value: FeeMethod; onChange: (v: FeeMethod) => void; allowCustom: boolean }) {
  if (groupMonth.joinFeePolicy !== "ASK_EVERY_TIME") return null;
  return (
    <Field label="طريقة احتساب الرسوم" htmlFor="feeMethod">
      <Select value={value} onValueChange={(v) => onChange(v as FeeMethod)}>
        <SelectTrigger id="feeMethod"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="FULL_MONTH">الرسوم الشهرية كاملة</SelectItem>
          <SelectItem value="REMAINING_SESSIONS">حسب الحصص المتبقية</SelectItem>
          {allowCustom ? <SelectItem value="CUSTOM">مبلغ مخصص</SelectItem> : null}
        </SelectContent>
      </Select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — bulk-enroll existing students
// ---------------------------------------------------------------------------

interface SelectedStudent {
  name: string;
  reEnroll: boolean; // was previously in this group (withdrawn/stopped) → reactivation, not a new join
}
interface BatchOutcome {
  total: number;
  ok: number;
  failed: Array<{ studentId: string; name: string; message: string }>;
}
const ar = (n: number) => new Intl.NumberFormat("ar-EG").format(n);
const ACTIVE_ROSTER_STATUSES = new Set(["ACTIVE", "PENDING"]);

function ExistingStudentsTab({ group, groupMonth, onDone }: { group: { id: string; name: string }; groupMonth: GroupMonth; onDone: () => void }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [selected, setSelected] = useState<Map<string, SelectedStudent>>(new Map());
  const [feeMethod, setFeeMethod] = useState<FeeMethod>("FULL_MONTH");
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null);

  // The group's current-month roster carries EVERY enrollment status for this
  // group (the report roster query has no status filter), so we can tell, per
  // searched student, whether they are ACTIVE here (offer nothing — already in),
  // were PREVIOUSLY here (offer as a clearly-labelled re-enrollment), or are new.
  const reportQuery = useQuery({
    queryKey: workspaceId ? qk.reports.group(workspaceId, group.id) : ["group-report", "none"],
    queryFn: () => fetchGroupReport(workspaceId!, group.id),
    enabled: !!workspaceId,
  });
  const statusByStudent = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reportQuery.data?.roster ?? []) map.set(r.studentId, r.status);
    return map;
  }, [reportQuery.data]);

  /** NEW = never in this group; ACTIVE = currently enrolled here; PAST = withdrawn/stopped/transferred here. */
  function classify(id: string): "NEW" | "ACTIVE" | "PAST" {
    const st = statusByStudent.get(id);
    if (!st) return "NEW";
    return ACTIVE_ROSTER_STATUSES.has(st) ? "ACTIVE" : "PAST";
  }

  const searchQuery = useQuery({
    queryKey: ["student-search", workspaceId, debouncedSearch, "for-enroll"],
    queryFn: () => fetchStudents(workspaceId!, { q: debouncedSearch, limit: 12 }),
    enabled: !!workspaceId && debouncedSearch.length > 0,
  });
  const results = searchQuery.data?.items ?? [];

  function toggle(id: string, name: string, reEnroll: boolean) {
    setOutcome(null);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, { name, reEnroll });
      return next;
    });
  }

  const batch = useMutation({
    mutationFn: async () => {
      const attempted = new Map(selected); // snapshot names for the result panel
      const res = await batchEnrollStudents(workspaceId!, groupMonth.id, {
        studentIds: Array.from(attempted.keys()),
        joinDate: todayIso(),
        // Batch excludes CUSTOM by contract; narrow defensively (the picker never offers it here).
        feeMethod: groupMonth.joinFeePolicy === "ASK_EVERY_TIME" ? (feeMethod === "REMAINING_SESSIONS" ? "REMAINING_SESSIONS" : "FULL_MONTH") : undefined,
      });
      return { res, attempted };
    },
    onSuccess: ({ res, attempted }) => {
      invalidateAfterEnrollment(queryClient, workspaceId!, { groupId: group.id });
      const ok = res.enrolledCount + res.reactivatedCount;
      const total = res.results.length;
      const failed = res.results
        .filter((r) => r.outcome === "FAILED")
        .map((r) => ({ studentId: r.studentId, name: attempted.get(r.studentId)?.name ?? "طالب", message: r.message ?? "تعذّر تسجيل هذا الطالب." }));

      if (failed.length === 0) {
        toast.success(`تم تسجيل ${ar(ok)} من الطلاب في ${group.name}`);
        onDone();
        return;
      }
      // Partial success — NEVER imply the whole batch succeeded. Show exactly
      // what landed and what didn't, keep the failed ones selected for retry.
      setOutcome({ total, ok, failed });
      setSelected((prev) => new Map(prev.size ? Array.from(prev).filter(([id]) => failed.some((f) => f.studentId === id)) : []));
      toast.warning(`تم تسجيل ${ar(ok)} من ${ar(total)} — تعذّر تسجيل ${ar(failed.length)}`);
    },
    onError: () => toast.error("تعذّر تسجيل الطلاب، حاول مجددًا"),
  });

  const count = selected.size;
  const reCount = Array.from(selected.values()).filter((s) => s.reEnroll).length;

  const ctaLabel = count === 0
    ? "تسجيل الطلاب"
    : reCount === count
      ? `إعادة تسجيل ${ar(count)}`
      : reCount > 0
        ? `تسجيل ${ar(count)} (منهم ${ar(reCount)} إعادة تسجيل)`
        : `تسجيل ${ar(count)} طلاب`;

  return (
    <div className="flex flex-col gap-3">
      <FeeMethodField groupMonth={groupMonth} value={feeMethod} onChange={setFeeMethod} allowCustom={false} />

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو كود الطالب..." className="ps-9" />
      </div>

      {/* Selected chips */}
      {count > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(selected).map(([id, s]) => (
            <button
              key={id}
              type="button"
              onClick={() => toggle(id, s.name, s.reEnroll)}
              className="inline-flex items-center gap-1 rounded-full bg-brand-subtle px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-subtle/70"
            >
              {s.reEnroll ? <RotateCcw className="h-3 w-3" aria-hidden /> : null}
              {s.name}
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-h-[8rem] rounded-md border border-border">
        {debouncedSearch.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-tertiary">ابحث لإضافة طلاب موجودين إلى المجموعة.</p>
        ) : searchQuery.isLoading ? (
          <div className="flex flex-col gap-1 p-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : results.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-tertiary">لا يوجد طلاب مطابقون.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {results.map((s) => {
              const cls = classify(s.id);
              const isSel = selected.has(s.id);
              // Currently enrolled here → not a natural add option (shown disabled, labelled).
              if (cls === "ACTIVE") {
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 px-3 py-2.5 opacity-70">
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-text-primary">{s.name}</span>
                      <span className="text-xs text-text-tertiary">{s.studentCode}</span>
                    </span>
                    <Badge tone="success">مسجّل بالفعل</Badge>
                  </li>
                );
              }
              const reEnroll = cls === "PAST";
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => toggle(s.id, s.name, reEnroll)}
                    className={cn("flex w-full items-center justify-between gap-2 px-3 py-2.5 text-start hover:bg-surface-sunken", isSel && "bg-surface-sunken")}
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-text-primary">{s.name}</span>
                      <span className="text-xs text-text-tertiary">{s.studentCode}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {reEnroll ? <Badge tone="neutral">سابقًا في المجموعة</Badge> : null}
                      <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", isSel ? "border-brand bg-brand text-brand-foreground" : "border-border-strong")}>
                        {isSel ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Partial-success result panel — explicit, never hidden behind a generic toast. */}
      {outcome ? (
        <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-subtle p-3">
          <p className="text-sm font-semibold text-text-primary">تم تسجيل {ar(outcome.ok)} من {ar(outcome.total)} طلاب.</p>
          <p className="text-xs text-text-secondary">تعذّر تسجيل الطلاب التاليين:</p>
          <ul className="flex flex-col gap-1 text-sm text-text-secondary">
            {outcome.failed.map((f) => (
              <li key={f.studentId} className="flex flex-col rounded-md bg-surface px-2.5 py-1.5">
                <span className="font-medium text-text-primary">{f.name}</span>
                <span className="text-xs text-danger">{f.message}</span>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="self-start" loading={batch.isPending} onClick={() => batch.mutate()}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            إعادة محاولة المتعذّرين
          </Button>
        </div>
      ) : null}

      {reCount > 0 ? (
        <p className="text-xs text-text-tertiary">{ar(reCount)} من المحدّدين كانوا سابقًا في المجموعة — سيُعاد تسجيلهم.</p>
      ) : null}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-2 border-t border-border bg-surface px-1 pt-3">
        <span className="text-sm text-text-secondary">{count > 0 ? `${ar(count)} محدّدون` : "لم يُحدَّد أحد"}</span>
        <Button disabled={count === 0} loading={batch.isPending} onClick={() => batch.mutate()}>
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — create a new student, pre-enrolled into this group
// ---------------------------------------------------------------------------

interface Candidate {
  studentId: string;
  name: string;
  studentCode: string;
}

function NewStudentTab({ group, groupMonth }: { group: { id: string; name: string }; groupMonth: GroupMonth }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [feeMethod, setFeeMethod] = useState<FeeMethod>("FULL_MONTH");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [ackDuplicates, setAckDuplicates] = useState(false);
  const [createdStudentId, setCreatedStudentId] = useState<string | null>(null); // recovery: created but enroll failed

  const canSubmit = name.trim().length > 0;
  const acted = candidates && candidates.length > 0;

  function resetForm() {
    setName("");
    setGuardianName("");
    setGuardianPhone("");
    setCandidates(null);
    setAckDuplicates(false);
    setCreatedStudentId(null);
  }
  function invalidateGate() {
    setCandidates(null);
    setAckDuplicates(false);
  }

  async function enrollExisting(studentId: string) {
    try {
      await enrollStudentIntoGroupMonth(workspaceId!, groupMonth, {
        studentId,
        joinDate: todayIso(),
        feeMethod: groupMonth.joinFeePolicy === "ASK_EVERY_TIME" ? feeMethod : undefined,
      });
      invalidateAfterEnrollment(queryClient, workspaceId!, { studentId, groupId: group.id });
      toast.success(`تم تسجيل الطالب في ${group.name}`);
      resetForm();
      nameRef.current?.focus();
    } catch {
      toast.error("تعذّر تسجيل هذا الطالب في المجموعة");
    }
  }

  const submit = useMutation({
    mutationFn: async (addAnother: boolean) => {
      // Recovery path: student already created, only the enroll step failed.
      if (createdStudentId) {
        await enrollStudentIntoGroupMonth(workspaceId!, groupMonth, {
          studentId: createdStudentId,
          joinDate: todayIso(),
          feeMethod: groupMonth.joinFeePolicy === "ASK_EVERY_TIME" ? feeMethod : undefined,
        });
        return { studentId: createdStudentId, addAnother, recovered: true };
      }

      // Duplicate gate (first press).
      if (!ackDuplicates) {
        const match = await previewStudentMatch(workspaceId!, { name: name.trim(), guardianPhone: guardianPhone.trim() || undefined });
        if (match.candidates.length > 0) {
          return { gate: match.candidates as Candidate[] };
        }
      }

      const created = await createStudent(workspaceId!, {
        name: name.trim(),
        guardians: guardianPhone.trim()
          ? [{ name: guardianName.trim() || undefined, phone: guardianPhone.trim(), relationship: "guardian", isPrimary: true }]
          : undefined,
      });
      // Student is saved. Enroll — if THIS fails, keep the student (recovery).
      try {
        await enrollStudentIntoGroupMonth(workspaceId!, groupMonth, {
          studentId: created.student.id,
          joinDate: todayIso(),
          feeMethod: groupMonth.joinFeePolicy === "ASK_EVERY_TIME" ? feeMethod : undefined,
        });
      } catch (enrollError) {
        return { studentId: created.student.id, enrollFailed: true };
      }
      return { studentId: created.student.id, addAnother };
    },
    onSuccess: (res: { gate?: Candidate[]; studentId?: string; addAnother?: boolean; enrollFailed?: boolean; recovered?: boolean }) => {
      if (res.gate) {
        setCandidates(res.gate);
        setAckDuplicates(true);
        return;
      }
      if (res.enrollFailed && res.studentId) {
        setCreatedStudentId(res.studentId);
        queryClient.invalidateQueries({ queryKey: qk.students.list(workspaceId!) });
        toast.warning("تم حفظ الطالب، لكن تعذّر تسجيله في المجموعة. أعد المحاولة.");
        return;
      }
      // Success (fresh create+enroll OR recovery).
      invalidateAfterEnrollment(queryClient, workspaceId!, { studentId: res.studentId, groupId: group.id });
      toast.success(`تمت إضافة الطالب وتسجيله في ${group.name}`);
      resetForm();
      nameRef.current?.focus();
    },
    onError: () => toast.error("تعذّر حفظ الطالب، حاول مجددًا"),
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit.mutate(false); }}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
        <UserPlus className="h-4 w-4 text-brand" aria-hidden />
        <span className="text-text-secondary">سيُسجَّل الطالب في: <span className="font-medium text-text-primary">{group.name}</span></span>
      </div>

      <FeeMethodField groupMonth={groupMonth} value={feeMethod} onChange={setFeeMethod} allowCustom />

      <Field label="اسم الطالب" htmlFor="new-name" required>
        <Input id="new-name" ref={nameRef} value={name} onChange={(e) => { setName(e.target.value); invalidateGate(); setCreatedStudentId(null); }} autoFocus />
      </Field>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="ولي الأمر (اختياري)" htmlFor="new-g-name">
          <Input id="new-g-name" value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="الاسم" />
        </Field>
        <Field label="رقم الهاتف" htmlFor="new-g-phone">
          <Input id="new-g-phone" dir="ltr" inputMode="tel" value={guardianPhone} onChange={(e) => { setGuardianPhone(e.target.value); invalidateGate(); }} />
        </Field>
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
                <span>{c.name} — {c.studentCode}</span>
                <button type="button" className="shrink-0 text-xs font-medium text-brand hover:underline" onClick={() => enrollExisting(c.studentId)}>
                  سجّل هذا الطالب
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-tertiary">سجّل الطالب الموجود بدل إنشاء نسخة مكررة، أو أكمل الحفظ إذا كان طالبًا مختلفًا.</p>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {createdStudentId ? (
          <Button type="button" variant="outline" onClick={() => router.push(`/students/${createdStudentId}`)}>
            فتح ملف الطالب
          </Button>
        ) : null}
        <Button type="submit" loading={submit.isPending} disabled={!canSubmit}>
          {createdStudentId ? "إعادة محاولة التسجيل" : acted ? "حفظ على أي حال" : "حفظ وتسجيل"}
        </Button>
      </div>
    </form>
  );
}
