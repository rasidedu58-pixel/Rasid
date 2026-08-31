"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EGYPT_GOVERNORATES,
  TEACHING_SUBJECTS,
  updateTeacherProfileRequestSchema,
} from "@academic-precision/contracts";
import {
  Button,
  Field,
  Input,
  SectionCard,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@academic-precision/ui";
import { qk } from "../../../lib/query-keys";
import { fetchMe, updateTeacherProfile } from "../../../lib/api/identity";
import { isValidationError, ApiRequestError } from "../../../lib/api/client";

/**
 * Settings → "البيانات الشخصية". The teacher edits their own name / phone /
 * governorate / subject (email is display-only — changing it needs a separate
 * verified auth flow). Backend validates + normalizes; RLS admits only the
 * caller's own row.
 */
export function PersonalInfoCard() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: qk.me(), queryFn: fetchMe });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectOther, setSubjectOther] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (seeded || !me.data) return;
    setFullName(me.data.user.fullName ?? "");
    setPhone(me.data.profile.phone ?? "");
    setGovernorate(me.data.profile.governorate ?? "");
    setSubject(me.data.profile.subject ?? "");
    setSubjectOther(me.data.profile.subjectOther ?? "");
    setSeeded(true);
  }, [me.data, seeded]);

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        fullName: fullName.trim() || undefined,
        phone: phone.trim() || undefined,
        governorate: governorate || undefined,
        subject: subject || undefined,
        subjectOther: subject === "OTHER" ? subjectOther.trim() : undefined,
      };
      const parsed = updateTeacherProfileRequestSchema.safeParse(payload);
      if (!parsed.success) {
        const errors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join(".") || "_root";
          errors[key] = [...(errors[key] ?? []), issue.message];
        }
        return Promise.reject(Object.assign(new Error("invalid"), { fieldErrors: errors }));
      }
      return updateTeacherProfile(parsed.data);
    },
    onSuccess: () => {
      setFieldErrors({});
      queryClient.invalidateQueries({ queryKey: qk.me() });
      toast.success("تم حفظ البيانات");
    },
    onError: (e: unknown) => {
      if (e instanceof ApiRequestError && isValidationError(e)) {
        setFieldErrors(e.fieldErrors ?? {});
        toast.error("راجع الحقول");
        return;
      }
      const fe = (e as { fieldErrors?: Record<string, string[]> })?.fieldErrors;
      if (fe) {
        setFieldErrors(fe);
        return;
      }
      toast.error("تعذّر الحفظ");
    },
  });

  return (
    <SectionCard title="البيانات الشخصية" description="اسمك وبيانات التواصل — يراها فريق راصد فقط عند الحاجة.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        noValidate
      >
        <Field label="الاسم" htmlFor="fullName" error={fieldErrors.fullName?.[0]}>
          <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} invalid={!!fieldErrors.fullName} />
        </Field>
        <Field label="رقم الهاتف" htmlFor="phone" error={fieldErrors.phone?.[0]}>
          <Input id="phone" type="tel" dir="ltr" inputMode="tel" placeholder="010xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!fieldErrors.phone} />
        </Field>
        <Field label="المحافظة" htmlFor="governorate" error={fieldErrors.governorate?.[0]}>
          <Select value={governorate} onValueChange={setGovernorate}>
            <SelectTrigger id="governorate">
              <SelectValue placeholder="اختر المحافظة" />
            </SelectTrigger>
            <SelectContent>
              {EGYPT_GOVERNORATES.map((g) => (
                <SelectItem key={g.code} value={g.code}>
                  {g.ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="المادة" htmlFor="subject" error={fieldErrors.subject?.[0]}>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger id="subject">
              <SelectValue placeholder="اختر المادة" />
            </SelectTrigger>
            <SelectContent>
              {TEACHING_SUBJECTS.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {subject === "OTHER" ? (
          <Field label="اسم المادة" htmlFor="subjectOther" error={fieldErrors.subjectOther?.[0]}>
            <Input id="subjectOther" value={subjectOther} onChange={(e) => setSubjectOther(e.target.value)} invalid={!!fieldErrors.subjectOther} />
          </Field>
        ) : null}
        <div>
          <Button type="submit" loading={mutation.isPending}>حفظ التغييرات</Button>
        </div>
      </form>
    </SectionCard>
  );
}
