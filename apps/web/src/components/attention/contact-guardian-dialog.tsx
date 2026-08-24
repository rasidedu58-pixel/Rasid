"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ContactOutcome, GuardianLink } from "@academic-precision/contracts";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, toast } from "@academic-precision/ui";
import { createContactLog } from "../../lib/api/attention";
import { useWorkspace } from "../../lib/workspace-provider";

const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  CONTACTED: "تم التواصل",
  NO_ANSWER: "لا يوجد رد",
  INVALID_NUMBER: "رقم غير صحيح",
  DEFERRED: "تأجيل المتابعة",
};

/**
 * The one shared "contact a guardian" flow (§14/§21). The WhatsApp text is
 * a plain, fully EDITABLE draft the teacher can rewrite before opening
 * wa.me — this page never sends anything itself and never claims
 * sent/delivered/read, since no real WhatsApp Business integration exists.
 * After the teacher actually attempts contact (in WhatsApp/by phone),
 * recording the real outcome here is what the backend persists.
 */
export function ContactGuardianDialog({
  guardian,
  studentId,
  attentionCaseId,
  open,
  onOpenChange,
}: {
  guardian: GuardianLink;
  studentId: string;
  attentionCaseId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { workspaceId } = useWorkspace();
  const [draft, setDraft] = useState(`مرحبًا ${guardian.name ?? ""}،\n\nأود التواصل معك بخصوص متابعة الطالب/ة.\n\nشكرًا لتعاونكم.`);
  const [outcome, setOutcome] = useState<ContactOutcome | "">("");
  const [notes, setNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");

  const waLink = `https://wa.me/${guardian.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(draft)}`;

  const mutation = useMutation({
    mutationFn: () =>
      createContactLog(workspaceId!, {
        studentId,
        guardianId: guardian.guardianId,
        attentionCaseId: attentionCaseId ?? null,
        channel: "WHATSAPP_DEEPLINK",
        draftSnapshot: draft,
        outcome: outcome as ContactOutcome,
        notes: notes || null,
        followUpAt: outcome === "DEFERRED" && followUpAt ? new Date(followUpAt).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success("تم تسجيل نتيجة التواصل");
      onOpenChange(false);
    },
    onError: () => toast.error("تعذّر تسجيل نتيجة التواصل"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>التواصل مع ولي الأمر</DialogTitle>
          <DialogDescription>راجع الرسالة ثم افتحها في واتساب. سجّل نتيجة التواصل بعد المحاولة.</DialogDescription>
        </DialogHeader>

        <Field label="نص الرسالة" htmlFor="draft" hint="قابل للتعديل قبل الإرسال">
          <Textarea id="draft" value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} />
        </Field>

        <Button asChild variant="outline">
          <a href={waLink} target="_blank" rel="noreferrer">
            فتح في واتساب
          </a>
        </Button>

        <div className="border-t border-border pt-4">
          <Field label="نتيجة التواصل" htmlFor="outcome" hint="بعد محاولة التواصل الفعلية">
            <Select value={outcome} onValueChange={(v) => setOutcome(v as ContactOutcome)}>
              <SelectTrigger id="outcome">
                <SelectValue placeholder="اختر النتيجة" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OUTCOME_LABEL).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {outcome === "DEFERRED" ? (
            <Field label="موعد المتابعة" htmlFor="followUpAt" required className="mt-3">
              <input id="followUpAt" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} className="flex h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm focus-ring" />
            </Field>
          ) : null}

          <Field label="ملاحظات" htmlFor="notes" hint="اختياري" className="mt-3">
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
        </div>

        <DialogFooter>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!outcome || (outcome === "DEFERRED" && !followUpAt)}>
            حفظ نتيجة التواصل
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
