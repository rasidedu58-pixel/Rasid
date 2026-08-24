"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { CreateGroupRequest } from "@academic-precision/contracts";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input, toast } from "@academic-precision/ui";
import { Plus } from "lucide-react";
import { createGroup } from "../../../lib/api/scheduling";
import { qk } from "../../../lib/query-keys";
import { useWorkspace } from "../../../lib/workspace-provider";

export function CreateGroupDialog() {
  const { workspaceId, canWrite } = useWorkspace();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, formState } = useForm<CreateGroupRequest>();

  const mutation = useMutation({
    // Blank optional fields (subject/grade) are normalized "" -> undefined
    // globally in `apiRequest` (see its own comment for the real bug this
    // fixes — a 422 found via live QA) — no per-form workaround needed.
    mutationFn: (body: CreateGroupRequest) => createGroup(workspaceId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.groups.list(workspaceId!) });
      toast.success("تم إنشاء المجموعة");
      setOpen(false);
      reset();
    },
    onError: () => toast.error("تعذّر إنشاء المجموعة"),
  });

  if (!canWrite("CORE_OPERATIONS")) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" aria-hidden />
          مجموعة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>مجموعة جديدة</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="flex flex-col gap-4">
          <Field label="اسم المجموعة" htmlFor="name" required error={formState.errors.name?.message}>
            <Input id="name" {...register("name", { required: "اسم المجموعة مطلوب" })} />
          </Field>
          <Field label="المادة" htmlFor="subject" hint="اختياري">
            <Input id="subject" {...register("subject")} />
          </Field>
          <Field label="الصف الدراسي" htmlFor="grade" hint="اختياري">
            <Input id="grade" {...register("grade")} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>
              إنشاء
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
