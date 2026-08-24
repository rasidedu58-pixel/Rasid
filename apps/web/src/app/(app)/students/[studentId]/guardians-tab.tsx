"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { MessageCircle, Plus, Star } from "lucide-react";
import type { GuardianLink } from "@academic-precision/contracts";
import { Badge, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Field, Input, toast } from "@academic-precision/ui";
import { linkGuardian, setPrimaryGuardian } from "../../../../lib/api/students";
import { qk } from "../../../../lib/query-keys";
import { useWorkspace } from "../../../../lib/workspace-provider";
import { ContactGuardianDialog } from "../../../../components/attention/contact-guardian-dialog";

const ROLE_LABEL: Record<string, string> = {
  primary: "ولي أمر رئيسي",
  academic: "متابعة دراسية",
  financial: "متابعة مالية",
  guardian: "ولي أمر",
};

export function GuardiansTab({ studentId, guardians }: { studentId: string; guardians: GuardianLink[] }) {
  const { workspaceId, canWrite } = useWorkspace();
  const queryClient = useQueryClient();
  const [contactGuardian, setContactGuardian] = useState<GuardianLink | null>(null);

  const setPrimaryMutation = useMutation({
    mutationFn: (guardianId: string) => setPrimaryGuardian(workspaceId!, studentId, guardianId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.students.detail(workspaceId!, studentId) });
      toast.success("تم تعيين ولي الأمر الرئيسي");
    },
    onError: () => toast.error("تعذّر تنفيذ الإجراء"),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">{canWrite("CORE_OPERATIONS") ? <AddGuardianDialog studentId={studentId} /> : null}</div>

      {guardians.length === 0 ? (
        <Card className="p-6 text-center text-sm text-text-secondary">لا يوجد أولياء أمور مسجّلون بعد.</Card>
      ) : (
        guardians.map((g) => (
          <Card key={g.id} className="flex items-center justify-between p-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <p className="font-medium text-text-primary">{g.name ?? "بدون اسم"}</p>
                {g.isPrimary ? <Badge tone="brand">رئيسي</Badge> : null}
              </div>
              <p dir="ltr" className="text-end text-sm text-text-secondary">
                {g.phone}
              </p>
              <p className="text-xs text-text-tertiary">{ROLE_LABEL[g.relationship ?? ""] ?? g.relationship}</p>
            </div>
            <div className="flex items-center gap-2">
              {!g.isPrimary && canWrite("CORE_OPERATIONS") ? (
                <Button variant="ghost" size="sm" onClick={() => setPrimaryMutation.mutate(g.guardianId)} loading={setPrimaryMutation.isPending}>
                  <Star className="h-4 w-4" aria-hidden />
                  تعيين كرئيسي
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => setContactGuardian(g)}>
                <MessageCircle className="h-4 w-4" aria-hidden />
                تواصل
              </Button>
            </div>
          </Card>
        ))
      )}

      {contactGuardian ? <ContactGuardianDialog guardian={contactGuardian} studentId={studentId} open onOpenChange={() => setContactGuardian(null)} /> : null}
    </div>
  );
}

interface AddGuardianForm {
  name: string;
  phone: string;
  relationship: string;
}

function AddGuardianDialog({ studentId }: { studentId: string }) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, formState } = useForm<AddGuardianForm>({ defaultValues: { relationship: "guardian" } });

  const mutation = useMutation({
    mutationFn: (v: AddGuardianForm) => linkGuardian(workspaceId!, studentId, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.students.detail(workspaceId!, studentId) });
      toast.success("تمت إضافة ولي الأمر");
      setOpen(false);
      reset();
    },
    onError: () => toast.error("تعذّر إضافة ولي الأمر"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="h-4 w-4" aria-hidden />
          إضافة ولي أمر
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة ولي أمر</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="flex flex-col gap-4">
          <Field label="الاسم" htmlFor="gname" required error={formState.errors.name?.message}>
            <Input id="gname" {...register("name", { required: "الاسم مطلوب" })} />
          </Field>
          <Field label="رقم الهاتف" htmlFor="gphone" required error={formState.errors.phone?.message}>
            <Input id="gphone" dir="ltr" {...register("phone", { required: "رقم الهاتف مطلوب" })} />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={mutation.isPending}>
              إضافة
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
