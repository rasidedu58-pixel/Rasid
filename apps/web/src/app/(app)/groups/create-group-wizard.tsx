"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, CalendarPlus, Check, Clock, Plus, Trash2, UserPlus } from "lucide-react";
import {
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
  SheetHeader,
  SheetTitle,
  cn,
  toast,
} from "@academic-precision/ui";
import type { PrepareGroupCurrentMonthResponse } from "@academic-precision/contracts";
import { createGroup, prepareGroupCurrentMonth } from "../../../lib/api/scheduling";
import { ApiRequestError } from "../../../lib/api/client";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";

// weekday 0 = Monday … 6 = Sunday (matches the session generator + existing forms).
const WEEKDAY_LABELS = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];
const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

interface ScheduleRow {
  weekday: number;
  startTime: string;
  endTime: string;
}
const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const durationOf = (r: ScheduleRow) => toMinutes(r.endTime) - toMinutes(r.startTime);

type Stage = "form" | "summary" | "need-month" | "retry-prepare";

export function CreateGroupWizard() {
  const { workspaceId, canWrite } = useWorkspace();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [stage, setStage] = useState<Stage>("form");

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [rows, setRows] = useState<ScheduleRow[]>([{ weekday: 5, startTime: "16:00", endTime: "18:00" }]);
  const [feeMajor, setFeeMajor] = useState("");
  const [dueDay, setDueDay] = useState("");

  // Persisted across a failed prepare so a retry never re-creates the group.
  const [createdGroupId, setCreatedGroupId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ groupId: string; res: PrepareGroupCurrentMonthResponse } | null>(null);

  function resetAll() {
    setStep(1);
    setStage("form");
    setName("");
    setSubject("");
    setGrade("");
    setRows([{ weekday: 5, startTime: "16:00", endTime: "18:00" }]);
    setFeeMajor("");
    setDueDay("");
    setCreatedGroupId(null);
    setSummary(null);
    submit.reset();
  }
  function handleOpenChange(v: boolean) {
    if (!v) resetAll();
    setOpen(v);
  }

  const validRows = rows.every((r) => durationOf(r) > 0);
  const step1Valid = name.trim().length > 0;
  const step2Valid = rows.length > 0 && validRows;
  const step3Valid = feeMajor.trim() !== "" && Number(feeMajor) >= 0;

  const submit = useMutation({
    mutationFn: async () => {
      let groupId = createdGroupId;
      if (!groupId) {
        const g = await createGroup(workspaceId!, { name: name.trim(), subject: subject.trim() || undefined, grade: grade.trim() || undefined });
        groupId = g.id;
        setCreatedGroupId(g.id);
      }
      const res = await prepareGroupCurrentMonth(workspaceId!, groupId, {
        baseFeeMinor: Math.round(Number(feeMajor) * 100),
        currencyCode: "EGP",
        duePolicy: "PER_GROUP",
        dueDay: dueDay.trim() ? Number(dueDay) : null,
        joinFeePolicy: "FULL",
        scheduleRules: rows.map((r) => ({ weekday: r.weekday, startTime: r.startTime, durationMinutes: durationOf(r) })),
      });
      return { groupId, res };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: qk.groups.list(workspaceId!) });
      setSummary(data);
      setStage("summary");
    },
    onError: (e) => {
      // The group may already be created (createdGroupId set inside mutationFn):
      // branch into a recovery stage that retries ONLY the prepare step.
      if (e instanceof ApiRequestError && e.code === "NO_CURRENT_MONTH") setStage("need-month");
      else if (createdGroupId) setStage("retry-prepare");
      else toast.error("تعذّر إنشاء المجموعة");
    },
  });

  if (!canWrite("CORE_OPERATIONS")) return null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        مجموعة جديدة
      </Button>
      <SheetContent side="end" className="flex w-full max-w-lg flex-col">
        {stage === "form" ? (
          <>
            <SheetHeader>
              <SheetTitle>مجموعة جديدة</SheetTitle>
              <StepDots step={step} />
            </SheetHeader>

            <div className="mt-5 flex flex-1 flex-col gap-5 overflow-y-auto pb-4">
              {step === 1 ? (
                <Section title="بيانات المجموعة" subtitle="المعلومات الأساسية — يمكنك تعديلها لاحقًا.">
                  <Field label="اسم المجموعة" htmlFor="g-name" required>
                    <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: الصف الثالث — الجبر" autoFocus />
                  </Field>
                  <Field label="المادة" htmlFor="g-subject" hint="اختياري">
                    <Input id="g-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </Field>
                  <Field label="الصف الدراسي" htmlFor="g-grade" hint="اختياري">
                    <Input id="g-grade" value={grade} onChange={(e) => setGrade(e.target.value)} />
                  </Field>
                </Section>
              ) : step === 2 ? (
                <Section title="الجدول الأسبوعي" subtitle="مواعيد الحصص المتكررة كل أسبوع — أضف موعدًا واحدًا أو أكثر.">
                  <div className="flex flex-col gap-2">
                    {rows.map((r, i) => {
                      const dur = durationOf(r);
                      return (
                        <div key={i} className="rounded-xl border border-border bg-surface p-3">
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <label className="mb-1 block text-xs text-text-secondary">اليوم</label>
                              <Select value={String(r.weekday)} onValueChange={(v) => setRows((p) => p.map((x, j) => (j === i ? { ...x, weekday: Number(v) } : x)))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {WEEKDAY_LABELS.map((label, day) => (
                                    <SelectItem key={day} value={String(day)}>{label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-text-secondary">من</label>
                              <input type="time" value={r.startTime} onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, startTime: e.target.value } : x)))} className="focus-ring h-9 rounded-md border border-border bg-surface px-2 text-sm tabular-nums text-text-primary" />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs text-text-secondary">إلى</label>
                              <input type="time" value={r.endTime} onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, endTime: e.target.value } : x)))} className="focus-ring h-9 rounded-md border border-border bg-surface px-2 text-sm tabular-nums text-text-primary" />
                            </div>
                            {rows.length > 1 ? (
                              <Button variant="ghost" size="icon" className="text-danger" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} aria-label="حذف الموعد">
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            ) : null}
                          </div>
                          {dur <= 0 ? <p className="mt-1.5 text-xs text-danger">وقت النهاية يجب أن يكون بعد البداية.</p> : <p className="mt-1.5 text-xs text-text-tertiary">المدة: {arNum(dur)} دقيقة</p>}
                        </div>
                      );
                    })}
                    <Button variant="outline" size="sm" className="self-start" onClick={() => setRows((p) => [...p, { weekday: 5, startTime: "16:00", endTime: "18:00" }])}>
                      <Plus className="h-4 w-4" aria-hidden />
                      إضافة موعد
                    </Button>
                  </div>
                </Section>
              ) : (
                <Section title="الرسوم والتشغيل" subtitle="رسوم هذا الشهر لهذه المجموعة.">
                  <Field label="الرسوم الشهرية (جنيه)" htmlFor="g-fee" required>
                    <Input id="g-fee" type="number" inputMode="numeric" min={0} value={feeMajor} onChange={(e) => setFeeMajor(e.target.value)} placeholder="مثال: 300" />
                  </Field>
                  <Field label="يوم الاستحقاق في الشهر" htmlFor="g-dueday" hint="اختياري — من 1 إلى 28">
                    <Input id="g-dueday" type="number" inputMode="numeric" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="مثال: 5" />
                  </Field>
                  <div className="rounded-lg border border-dashed border-border bg-surface-sunken/40 px-3 py-2.5 text-xs text-text-secondary">
                    ستُنشأ حصص هذا الشهر تلقائيًا من الجدول الأسبوعي، وتُضاف الرسوم عند تسجيل الطلاب.
                  </div>
                </Section>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={() => (step === 1 ? handleOpenChange(false) : setStep((s) => (s - 1) as 1 | 2))}>
                {step === 1 ? "إلغاء" : <><ArrowRight className="h-4 w-4" aria-hidden /> السابق</>}
              </Button>
              {step < 3 ? (
                <Button onClick={() => setStep((s) => (s + 1) as 2 | 3)} disabled={step === 1 ? !step1Valid : !step2Valid}>
                  التالي <ArrowLeft className="h-4 w-4" aria-hidden />
                </Button>
              ) : (
                <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={!step3Valid}>
                  <CalendarPlus className="h-4 w-4" aria-hidden />
                  إنشاء وتجهيز الشهر
                </Button>
              )}
            </div>
          </>
        ) : stage === "summary" && summary ? (
          <SummaryView
            name={name}
            rows={rows}
            feeMajor={feeMajor}
            generated={summary.res.generatedSessionCount}
            already={summary.res.status === "ALREADY_PREPARED"}
            onOpenGroup={() => {
              const id = summary.groupId;
              handleOpenChange(false);
              router.push(`/groups/${id}`);
            }}
            onAnother={resetAll}
          />
        ) : stage === "need-month" ? (
          <RecoveryView
            title="المجموعة أُنشئت — لكن لا يوجد شهر تشغيلي حالي"
            body="تم إنشاء المجموعة بنجاح. لتوليد الحصص والرسوم لهذا الشهر، جهّز الشهر التشغيلي أولًا، ثم يمكنك تجهيز هذه المجموعة."
            primaryLabel="تجهيز الشهر"
            onPrimary={() => { handleOpenChange(false); router.push("/months/new"); }}
            secondaryLabel="فتح المجموعة"
            onSecondary={() => { const id = createdGroupId!; handleOpenChange(false); router.push(`/groups/${id}`); }}
          />
        ) : (
          <RecoveryView
            title="المجموعة أُنشئت — لكن تعذّر تجهيز الشهر"
            body="تم إنشاء المجموعة بنجاح، لكن حدث خطأ أثناء توليد الحصص. يمكنك إعادة المحاولة دون إنشاء مجموعة جديدة."
            primaryLabel="إعادة محاولة التجهيز"
            onPrimary={() => { setStage("form"); setStep(3); submit.mutate(); }}
            primaryLoading={submit.isPending}
            secondaryLabel="فتح المجموعة"
            onSecondary={() => { const id = createdGroupId!; handleOpenChange(false); router.push(`/groups/${id}`); }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function StepDots({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["البيانات", "الجدول", "الرسوم"];
  return (
    <div className="mt-2 flex items-center gap-1.5">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-1.5">
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", i + 1 < step ? "bg-brand/20 text-brand" : i + 1 === step ? "bg-brand text-brand-foreground" : "bg-surface-sunken text-text-tertiary")}>
            {i + 1 < step ? <Check className="h-3.5 w-3.5" aria-hidden /> : arNum(i + 1)}
          </span>
          <span className={cn("text-xs", i + 1 === step ? "font-medium text-text-primary" : "text-text-tertiary")}>{l}</span>
          {i < 2 ? <span className="mx-0.5 h-px w-4 bg-border" aria-hidden /> : null}
        </div>
      ))}
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        <p className="mt-0.5 text-sm text-text-secondary">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function SummaryView({ name, rows, feeMajor, generated, already, onOpenGroup, onAnother }: { name: string; rows: ScheduleRow[]; feeMajor: string; generated: number; already: boolean; onOpenGroup: () => void; onAnother: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <SheetHeader>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
          <Check className="h-6 w-6 text-success" aria-hidden />
        </div>
        <SheetTitle className="mt-3">{already ? "المجموعة مُجهّزة بالفعل لهذا الشهر" : "تم إنشاء المجموعة وتجهيز الشهر"}</SheetTitle>
      </SheetHeader>
      <div className="mt-5 flex flex-1 flex-col gap-3 overflow-y-auto">
        <SummaryRow label="المجموعة" value={name} />
        <div className="rounded-lg border border-border bg-surface px-4 py-3">
          <p className="mb-2 text-xs text-text-secondary">المواعيد</p>
          <div className="flex flex-col gap-1.5">
            {rows.map((r, i) => (
              <span key={i} className="flex items-center gap-2 text-sm text-text-primary">
                <Clock className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
                {WEEKDAY_LABELS[r.weekday]} <span className="tabular-nums">{r.startTime}–{r.endTime}</span>
              </span>
            ))}
          </div>
        </div>
        <SummaryRow label="الرسوم الشهرية" value={`${arNum(Number(feeMajor))} جنيه`} />
        <div className="flex items-center justify-between rounded-lg border border-brand/30 bg-brand-subtle/20 px-4 py-3">
          <span className="text-sm text-text-secondary">الحصص المولّدة لهذا الشهر</span>
          <span className="text-lg font-bold tabular-nums text-brand">{arNum(generated)}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onAnother}>
          <UserPlus className="h-4 w-4" aria-hidden />
          مجموعة أخرى
        </Button>
        <Button onClick={onOpenGroup}>فتح المجموعة <ArrowLeft className="h-4 w-4" aria-hidden /></Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}

function RecoveryView({ title, body, primaryLabel, onPrimary, primaryLoading, secondaryLabel, onSecondary }: { title: string; body: string; primaryLabel: string; onPrimary: () => void; primaryLoading?: boolean; secondaryLabel: string; onSecondary: () => void }) {
  return (
    <div className="flex flex-1 flex-col">
      <SheetHeader>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-warning-subtle">
          <AlertTriangle className="h-6 w-6 text-warning" aria-hidden />
        </div>
        <SheetTitle className="mt-3">{title}</SheetTitle>
      </SheetHeader>
      <p className="mt-4 flex-1 text-sm leading-relaxed text-text-secondary">{body}</p>
      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onSecondary}>{secondaryLabel}</Button>
        <Button onClick={onPrimary} loading={primaryLoading}>{primaryLabel}</Button>
      </div>
    </div>
  );
}
