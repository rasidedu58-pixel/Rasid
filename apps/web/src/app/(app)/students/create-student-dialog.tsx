"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Plus, AlertTriangle } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input, toast } from "@academic-precision/ui";
import { createStudent, previewStudentMatch } from "../../../lib/api/students";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";

interface FormValues {
  name: string;
  guardianName?: string;
  guardianPhone?: string;
}

/** Duplicate-detection UX (§13): before an actual create, run match-preview and surface any name/phone collisions — the caller explicitly confirms "create anyway" rather than silently creating a possible duplicate. */
export function CreateStudentDialog() {
  const router = useRouter();
  const { workspaceId, canWrite } = useWorkspace();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ studentId: string; name: string; studentCode: string }> | null>(null);
  const { register, handleSubmit, reset, formState } = useForm<FormValues>();

  const previewMutation = useMutation({
    mutationFn: (v: FormValues) => previewStudentMatch(workspaceId!, { name: v.name, guardianPhone: v.guardianPhone || undefined }),
  });

  const createMutation = useMutation({
    mutationFn: (v: FormValues) =>
      createStudent(workspaceId!, {
        name: v.name,
        guardians: v.guardianName && v.guardianPhone ? [{ name: v.guardianName, phone: v.guardianPhone, relationship: "guardian", isPrimary: true }] : undefined,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: qk.students.list(workspaceId!) });
      toast.success("تم إضافة الطالب");
      setOpen(false);
      reset();
      setCandidates(null);
      router.push(`/students/${res.student.id}`);
    },
    onError: () => toast.error("تعذّر إضافة الطالب"),
  });

  async function onSubmit(values: FormValues) {
    if (candidates === null) {
      const result = await previewMutation.mutateAsync(values);
      if (result.candidates.length > 0) {
        setCandidates(result.candidates);
        return;
      }
    }
    createMutation.mutate(values);
  }

  if (!canWrite("CORE_OPERATIONS")) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          setCandidates(null);
        }
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
          <DialogTitle>إضافة طالب جديد</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <Field label="اسم الطالب" htmlFor="name" required error={formState.errors.name?.message}>
            <Input id="name" {...register("name", { required: "اسم الطالب مطلوب" })} onChange={() => setCandidates(null)} />
          </Field>
          <Field label="اسم ولي الأمر" htmlFor="guardianName" hint="اختياري — إذا أضفته فأدخل رقم هاتفه أيضًا">
            <Input id="guardianName" {...register("guardianName")} onChange={() => setCandidates(null)} />
          </Field>
          <Field label="رقم هاتف ولي الأمر" htmlFor="guardianPhone" hint="مطلوب فقط عند إضافة اسم ولي الأمر">
            <Input id="guardianPhone" dir="ltr" {...register("guardianPhone")} onChange={() => setCandidates(null)} />
          </Field>

          {candidates && candidates.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-subtle p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                يوجد طلاب مشابهون بالفعل
              </div>
              <ul className="text-sm text-text-secondary">
                {candidates.map((c) => (
                  <li key={c.studentId}>
                    {c.name} — {c.studentCode}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-tertiary">تحقق من القائمة أعلاه، ثم اضغط "إضافة على أي حال" إذا كان هذا طالبًا مختلفًا فعلًا.</p>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="submit" loading={previewMutation.isPending || createMutation.isPending}>
              {candidates && candidates.length > 0 ? "إضافة على أي حال" : "إضافة الطالب"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
