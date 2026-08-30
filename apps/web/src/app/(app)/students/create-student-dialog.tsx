"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus, Trash2, UserPlus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  toast,
} from "@academic-precision/ui";
import { createStudent, previewStudentMatch } from "../../../lib/api/students";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";

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
 * Fast student add (§18–19): student name + guardian(s), with a "save and add
 * another" flow for entering many students quickly, plus the existing
 * duplicate-candidate gate (match-preview). Multiple guardians are supported
 * (the backend already allows many; the first with a phone is primary).
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

  function resetForm() {
    setName("");
    setGuardians([emptyGuardian()]);
    setCandidates(null);
    setAckDuplicates(false);
  }
  function invalidateDuplicateGate() {
    setCandidates(null);
    setAckDuplicates(false);
  }

  const primaryPhone = guardians.find((g) => g.phone.trim())?.phone.trim();
  // A guardian row is only valid if it has a phone; a name without a phone can't be saved.
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

  async function submit(addAnother: boolean) {
    if (!canSubmit) return;
    setAddAnotherMode(addAnother);
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
    queryClient.invalidateQueries({ queryKey: qk.students.list(workspaceId!) });
    toast.success("تم إضافة الطالب");
    if (addAnother) {
      resetForm();
      nameRef.current?.focus();
    } else {
      setOpen(false);
      resetForm();
      router.push(`/students/${res.student.id}`);
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

          {acted ? (
            <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-subtle p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                قد يكون هذا الطالب موجودًا بالفعل
              </div>
              <ul className="flex flex-col gap-1 text-sm text-text-secondary">
                {candidates!.map((c) => (
                  <li key={c.studentId}>
                    <button type="button" className="text-brand hover:underline" onClick={() => { setOpen(false); router.push(`/students/${c.studentId}`); }}>
                      {c.name} — {c.studentCode}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-tertiary">راجع القائمة، ثم أكمل الحفظ إذا كان طالبًا مختلفًا فعلًا.</p>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" loading={busy && addAnotherMode} disabled={!canSubmit} onClick={() => void submit(true)}>
              {acted ? "حفظ على أي حال وإضافة آخر" : "حفظ وإضافة آخر"}
            </Button>
            <Button type="submit" loading={busy && !addAnotherMode} disabled={!canSubmit}>
              {acted ? "حفظ على أي حال" : "حفظ"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
