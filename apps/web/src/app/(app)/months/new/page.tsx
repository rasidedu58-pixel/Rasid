"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateMonthPreviewRequest, CreateMonthPreviewResponse } from "@academic-precision/contracts";
import { Badge, Button, Card, Checkbox, ErrorState, LoadingRegion, SectionCard, formatMoney, formatMonthLabel, toast } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { qk } from "../../../../lib/query-keys";
import { fetchGroups, fetchMonths, previewCreateMonth, confirmCreateMonth } from "../../../../lib/api/scheduling";
import { GroupConfigForm, EMPTY_GROUP_CONFIG, type GroupConfigDraft } from "./group-config-form";

type Mode = "CARRY_FORWARD" | "MANUAL";

function nextCalendarTarget(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function addMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * Prepare an Operating Month — the screen that closes Phase 11's real
 * blocker: a fresh workspace had no UI reaching `POST /months/preview` +
 * `POST /months` (both pre-existing, unused). A full page rather than a
 * dialog — per-group fee/schedule config is genuinely long, and a modal
 * would be unusable on a phone (§9's mobile requirement).
 */
export default function NewMonthPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { workspaceId, isOwner } = useWorkspace();

  const monthsQuery = useQuery({
    queryKey: workspaceId ? qk.months.list(workspaceId) : ["months", "none"],
    queryFn: () => fetchMonths(workspaceId!),
    enabled: !!workspaceId,
  });
  const groupsQuery = useQuery({
    queryKey: workspaceId ? qk.groups.list(workspaceId) : ["groups", "none"],
    queryFn: () => fetchGroups(workspaceId!),
    enabled: !!workspaceId,
  });

  const currentMonth = monthsQuery.data?.months.find((m) => m.status === "CURRENT") ?? null;

  const [target, setTarget] = useState(nextCalendarTarget());
  const [mode, setMode] = useState<Mode>("MANUAL");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Record<string, GroupConfigDraft>>({});
  const [preview, setPreview] = useState<CreateMonthPreviewResponse | null>(null);

  // A CURRENT month exists → default to carry-forward (the common "start
  // next month" path) and default the target to the month right after it.
  useEffect(() => {
    if (currentMonth) {
      setMode("CARRY_FORWARD");
      setTarget(addMonth(currentMonth.year, currentMonth.month));
    }
  }, [currentMonth]);

  function toggleGroup(groupId: string, checked: boolean) {
    setPreview(null);
    setSelectedGroupIds((prev) => (checked ? [...prev, groupId] : prev.filter((id) => id !== groupId)));
    setConfigs((prev) => (checked ? { ...prev, [groupId]: prev[groupId] ?? EMPTY_GROUP_CONFIG } : prev));
  }

  const requestBody = useMemo<CreateMonthPreviewRequest | null>(() => {
    if (mode === "CARRY_FORWARD") {
      if (!currentMonth) return null;
      return { targetYear: target.year, targetMonth: target.month, sourceMonthId: currentMonth.id };
    }
    if (selectedGroupIds.length === 0) return null;
    const groupInitialConfig: NonNullable<CreateMonthPreviewRequest["groupInitialConfig"]> = {};
    for (const groupId of selectedGroupIds) {
      const draft = configs[groupId] ?? EMPTY_GROUP_CONFIG;
      const baseFeeMinor = Math.round((Number(draft.baseFeeAmount) || 0) * 100);
      groupInitialConfig[groupId] = {
        baseFeeMinor,
        currencyCode: "EGP",
        duePolicy: draft.duePolicy,
        dueDay: draft.dueDay ? Number(draft.dueDay) : undefined,
        joinFeePolicy: draft.joinFeePolicy,
        scheduleRules: draft.scheduleRules.map((r) => ({ weekday: r.weekday, startTime: r.startTime, durationMinutes: Number(r.durationMinutes) || 60 })),
      };
    }
    return { targetYear: target.year, targetMonth: target.month, selectedGroupIds, groupInitialConfig };
  }, [mode, target, currentMonth, selectedGroupIds, configs]);

  const previewMutation = useMutation({
    mutationFn: (body: CreateMonthPreviewRequest) => previewCreateMonth(workspaceId!, body),
    onSuccess: (res) => setPreview(res),
    onError: () => toast.error("تعذّرت معاينة الشهر — تحقق من البيانات وحاول مرة أخرى."),
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmCreateMonth(workspaceId!, { previewToken: preview!.previewToken }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: qk.months.list(workspaceId!) });
      toast.success("تم تجهيز الشهر التشغيلي");
      router.push(`/months/${res.monthId}`);
    },
    onError: () => toast.error("تعذّر تأكيد الشهر — عاود المعاينة وحاول مرة أخرى."),
  });

  if (!isOwner) {
    return (
      <>
        <PageHeader title="تجهيز شهر تشغيلي" />
        <Card className="p-6 text-center text-sm text-text-secondary">تجهيز الشهر التشغيلي متاح لمالك المساحة فقط.</Card>
      </>
    );
  }

  if (monthsQuery.isLoading || groupsQuery.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (monthsQuery.isError || groupsQuery.isError || !groupsQuery.data) {
    return <ErrorState onRetry={() => { monthsQuery.refetch(); groupsQuery.refetch(); }} />;
  }

  const activeGroups = groupsQuery.data.groups.filter((g) => g.status === "ACTIVE");
  const monthInputValue = `${target.year}-${String(target.month).padStart(2, "0")}`;

  return (
    <>
      <PageHeader title={currentMonth ? "شهر تشغيلي جديد" : "تجهيز أول شهر تشغيلي"} description="حدّد الشهر المستهدف والمجموعات النشطة فيه، ثم عاين النتيجة قبل التأكيد." />

      <div className="flex flex-col gap-4">
        <SectionCard title="الشهر المستهدف">
          <input
            type="month"
            value={monthInputValue}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              if (y && m) {
                setTarget({ year: y, month: m });
                setPreview(null);
              }
            }}
            className="flex h-9 w-full max-w-48 rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary focus-ring"
          />
        </SectionCard>

        {currentMonth ? (
          <SectionCard title="طريقة التجهيز" description={`الشهر الحالي: ${formatMonthLabel(currentMonth.year, currentMonth.month)}`}>
            <div className="flex flex-col gap-2">
              <ModeOption
                selected={mode === "CARRY_FORWARD"}
                title="استكمال المجموعات النشطة تلقائيًا"
                description="كل مجموعة بها طلاب نشطون هذا الشهر تُنقل بنفس الرسوم والجدول، ويُسجَّل الطلاب المستمرون تلقائيًا."
                onSelect={() => { setMode("CARRY_FORWARD"); setPreview(null); }}
              />
              <ModeOption
                selected={mode === "MANUAL"}
                title="اختيار المجموعات يدويًا"
                description="حدّد المجموعات ورسومها وجدولها من جديد لهذا الشهر."
                onSelect={() => { setMode("MANUAL"); setPreview(null); }}
              />
            </div>
          </SectionCard>
        ) : null}

        {mode === "MANUAL" ? (
          <SectionCard title="المجموعات" description="حدّد المجموعات النشطة هذا الشهر، واضبط رسوم وجدول كل منها.">
            {activeGroups.length === 0 ? (
              <p className="text-sm text-text-secondary">
                لا توجد مجموعات دائمة بعد. أنشئ مجموعة أولًا من صفحة{" "}
                <a href="/groups" className="text-brand hover:underline">المجموعات</a>.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {activeGroups.map((group) => (
                  <div key={group.id} className="rounded-lg border border-border p-4">
                    <label className="flex cursor-pointer items-center gap-3">
                      <Checkbox checked={selectedGroupIds.includes(group.id)} onCheckedChange={(v) => toggleGroup(group.id, v === true)} />
                      <span className="font-medium text-text-primary">{group.name}</span>
                    </label>
                    {selectedGroupIds.includes(group.id) ? (
                      <GroupConfigForm
                        value={configs[group.id] ?? EMPTY_GROUP_CONFIG}
                        onChange={(next) => {
                          setPreview(null);
                          setConfigs((prev) => ({ ...prev, [group.id]: next }));
                        }}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        ) : null}

        {preview ? (
          <SectionCard title="معاينة الشهر">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <PreviewStat label="المجموعات" value={String(preview.groups.length)} />
              <PreviewStat label="الحصص المتوقعة" value={String(preview.generatedSessions)} />
              <PreviewStat label="طلاب مستمرون" value={String(preview.students.continuing)} />
              <PreviewStat label="إجمالي المستحقات الجديدة" value={formatMoney(preview.newObligationsTotalMinor)} />
            </div>
            {preview.students.excluded > 0 || preview.students.transferred > 0 ? (
              <p className="mt-3 text-xs text-text-tertiary">
                {preview.students.excluded > 0 ? `${preview.students.excluded} طالب لن يُنقل تلقائيًا. ` : ""}
                {preview.students.transferred > 0 ? `${preview.students.transferred} طالب منقول من مجموعة أخرى.` : ""}
              </p>
            ) : null}
          </SectionCard>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={!requestBody}
            loading={previewMutation.isPending}
            onClick={() => requestBody && previewMutation.mutate(requestBody)}
          >
            معاينة
          </Button>
          <Button disabled={!preview} loading={confirmMutation.isPending} onClick={() => confirmMutation.mutate()}>
            تأكيد وتجهيز الشهر
          </Button>
        </div>
      </div>
    </>
  );
}

function ModeOption({ selected, title, description, onSelect }: { selected: boolean; title: string; description: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-1 rounded-lg border px-4 py-3 text-start transition-colors ${selected ? "border-brand bg-brand-subtle" : "border-border hover:bg-surface-sunken"}`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-text-primary">
        {title}
        {selected ? <Badge tone="brand">مختار</Badge> : null}
      </span>
      <span className="text-xs text-text-secondary">{description}</span>
    </button>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{value}</p>
    </Card>
  );
}
