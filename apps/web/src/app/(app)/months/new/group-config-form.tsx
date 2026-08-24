"use client";

import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@academic-precision/ui";
import { X, Plus } from "lucide-react";

export interface ScheduleRuleDraft {
  weekday: number;
  startTime: string;
  durationMinutes: string;
}

export interface GroupConfigDraft {
  baseFeeAmount: string;
  duePolicy: "UNIFIED" | "PER_GROUP" | "OVERRIDE";
  dueDay: string;
  joinFeePolicy: "ASK_EVERY_TIME" | "FULL" | "REMAINING";
  scheduleRules: ScheduleRuleDraft[];
}

export const EMPTY_GROUP_CONFIG: GroupConfigDraft = {
  baseFeeAmount: "",
  duePolicy: "PER_GROUP",
  dueDay: "",
  joinFeePolicy: "FULL",
  scheduleRules: [],
};

const WEEKDAY_LABELS = ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"];

/**
 * Per-group commercial + schedule facts for a BRAND-NEW GroupMonth — exactly
 * the fields `CreateMonthPreviewRequest.groupInitialConfig[groupId]`
 * accepts (§Phase 3 contract). No field here is invented; `locationId` is
 * deliberately omitted — no Location entity/endpoint exists anywhere in the
 * backend to pick one from (verified before writing this form), so it is
 * left `undefined` (null) rather than faking a picker with nowhere real to
 * write.
 */
export function GroupConfigForm({ value, onChange }: { value: GroupConfigDraft; onChange: (next: GroupConfigDraft) => void }) {
  function addRule() {
    onChange({ ...value, scheduleRules: [...value.scheduleRules, { weekday: 0, startTime: "16:00", durationMinutes: "60" }] });
  }
  function updateRule(index: number, patch: Partial<ScheduleRuleDraft>) {
    onChange({ ...value, scheduleRules: value.scheduleRules.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  }
  function removeRule(index: number) {
    onChange({ ...value, scheduleRules: value.scheduleRules.filter((_, i) => i !== index) });
  }

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="الرسوم الشهرية (جنيه)" htmlFor="fee">
          <Input id="fee" type="number" min={0} inputMode="decimal" value={value.baseFeeAmount} onChange={(e) => onChange({ ...value, baseFeeAmount: e.target.value })} placeholder="مثال: 300" />
        </Field>
        <Field label="سياسة الاستحقاق" htmlFor="duePolicy">
          <Select value={value.duePolicy} onValueChange={(v) => onChange({ ...value, duePolicy: v as GroupConfigDraft["duePolicy"] })}>
            <SelectTrigger id="duePolicy"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="UNIFIED">موحّدة لكل المساحة</SelectItem>
              <SelectItem value="PER_GROUP">خاصة بهذه المجموعة</SelectItem>
              <SelectItem value="OVERRIDE">استثناء لهذا الشهر</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="يوم الاستحقاق" htmlFor="dueDay" hint="من 1 إلى 28 — اختياري">
          <Input id="dueDay" type="number" min={1} max={28} value={value.dueDay} onChange={(e) => onChange({ ...value, dueDay: e.target.value })} />
        </Field>
        <Field label="رسوم الانضمام أثناء الشهر" htmlFor="joinFeePolicy" hint="عند انضمام طالب جديد بعد بداية الشهر">
          <Select value={value.joinFeePolicy} onValueChange={(v) => onChange({ ...value, joinFeePolicy: v as GroupConfigDraft["joinFeePolicy"] })}>
            <SelectTrigger id="joinFeePolicy"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ASK_EVERY_TIME">اسأل في كل مرة</SelectItem>
              <SelectItem value="FULL">الرسوم كاملة دائمًا</SelectItem>
              <SelectItem value="REMAINING">حسب الحصص المتبقية دائمًا</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-primary">مواعيد الحصص الأسبوعية</p>
          <Button type="button" variant="outline" size="sm" onClick={addRule}>
            <Plus className="h-4 w-4" aria-hidden />
            إضافة موعد
          </Button>
        </div>

        {value.scheduleRules.length === 0 ? (
          <p className="text-xs text-text-tertiary">لا توجد مواعيد بعد — بدون موعد لن يتم توليد حصص لهذه المجموعة هذا الشهر.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {value.scheduleRules.map((rule, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                <div className="flex min-w-32 flex-1 flex-col gap-1.5">
                  <Select value={String(rule.weekday)} onValueChange={(v) => updateRule(index, { weekday: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAY_LABELS.map((label, day) => (
                        <SelectItem key={day} value={String(day)}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input type="time" value={rule.startTime} onChange={(e) => updateRule(index, { startTime: e.target.value })} className="w-32" />
                <Input type="number" min={5} value={rule.durationMinutes} onChange={(e) => updateRule(index, { durationMinutes: e.target.value })} className="w-24" placeholder="دقيقة" />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeRule(index)} aria-label="حذف الموعد">
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
