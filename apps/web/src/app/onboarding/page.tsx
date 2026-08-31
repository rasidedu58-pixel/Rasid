"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  EGYPT_GOVERNORATES,
  TEACHING_SUBJECTS,
  completeTeacherOnboardingRequestSchema,
} from "@academic-precision/contracts";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@academic-precision/ui";
import { ApiRequestError, isSessionExpired, isValidationError } from "../../lib/api/client";
import { fetchMe, updateTeacherProfile } from "../../lib/api/identity";
import { qk } from "../../lib/query-keys";
import { useSession } from "../../lib/session-provider";
import { AuthCard } from "../../components/auth/auth-card";

type State = "idle" | "saving";

/**
 * Teacher Onboarding — Step 2 ("عرّفنا بك في دقيقة"). Three fields only: phone,
 * governorate, subject (name + email were captured at signup). Mandatory: the
 * AuthGuard routes an owner here until the profile is complete. Phone is
 * prefilled from `/me` (e.g. a customer created via secure invite already has
 * name + phone) so the user never re-enters known data.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useSession();
  const me = useQuery({ queryKey: qk.me(), queryFn: fetchMe, enabled: sessionStatus === "authenticated" });

  const [state, setState] = useState<State>("idle");
  const [phone, setPhone] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectOther, setSubjectOther] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.replace("/login");
  }, [sessionStatus, router]);

  // Prefill any known profile fields once (customer-invite name/phone, or a
  // partially-completed profile), so the user only fills what's missing.
  useEffect(() => {
    if (prefilled || !me.data) return;
    const p = me.data.profile;
    if (p.phone) setPhone(p.phone);
    if (p.governorate) setGovernorate(p.governorate);
    if (p.subject) setSubject(p.subject);
    if (p.subjectOther) setSubjectOther(p.subjectOther);
    // Already complete (e.g. arrived here by mistake) → go straight to the app.
    if (p.profileCompleted) router.replace("/dashboard");
    setPrefilled(true);
  }, [me.data, prefilled, router]);

  const governorates = useMemo(() => EGYPT_GOVERNORATES, []);
  const subjects = useMemo(() => TEACHING_SUBJECTS, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldErrors({});

    const payload = { phone: phone.trim(), governorate, subject, subjectOther: subject === "OTHER" ? subjectOther.trim() : undefined };
    const parsed = completeTeacherOnboardingRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "_root";
        errors[key] = [...(errors[key] ?? []), issue.message];
      }
      setFieldErrors(errors);
      return;
    }

    setState("saving");
    try {
      await updateTeacherProfile(parsed.data);
      await queryClient.refetchQueries({ queryKey: qk.me() });
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (isSessionExpired(error)) {
          router.replace("/login?expired=1");
          return;
        }
        if (isValidationError(error)) {
          setFieldErrors((error as ApiRequestError).fieldErrors ?? {});
          setErrorMessage("بيانات غير صالحة. راجع الحقول أعلاه.");
          setState("idle");
          return;
        }
      }
      // Keep entered values on any transient failure — retry loses nothing.
      setErrorMessage("تعذّر الحفظ. تأكد من اتصالك وحاول مرة أخرى.");
      setState("idle");
    }
  }

  if (sessionStatus === "loading" || sessionStatus === "unauthenticated" || me.isLoading) {
    return (
      <AuthCard title="لحظة من فضلك…">
        <div />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="عرّفنا بك في دقيقة" description="هذه المعلومات تساعد راصد على تهيئة تجربتك بشكل أفضل.">
      <p className="mb-4 text-center text-xs font-medium text-text-tertiary">الخطوة 2 من 2</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="رقم الهاتف" htmlFor="phone" required error={fieldErrors.phone?.[0]}>
          <Input id="phone" type="tel" dir="ltr" inputMode="tel" placeholder="010xxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!fieldErrors.phone} />
        </Field>

        <Field label="المحافظة" htmlFor="governorate" required error={fieldErrors.governorate?.[0]}>
          <Select value={governorate} onValueChange={setGovernorate}>
            <SelectTrigger id="governorate">
              <SelectValue placeholder="اختر المحافظة" />
            </SelectTrigger>
            <SelectContent>
              {governorates.map((g) => (
                <SelectItem key={g.code} value={g.code}>
                  {g.ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="المادة التي تدرّسها" htmlFor="subject" required error={fieldErrors.subject?.[0]}>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger id="subject">
              <SelectValue placeholder="اختر المادة" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.ar}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {subject === "OTHER" ? (
          <Field label="اسم المادة" htmlFor="subjectOther" required error={fieldErrors.subjectOther?.[0]}>
            <Input id="subjectOther" type="text" value={subjectOther} onChange={(e) => setSubjectOther(e.target.value)} invalid={!!fieldErrors.subjectOther} />
          </Field>
        ) : null}

        {errorMessage ? (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <Button type="submit" loading={state === "saving"} size="lg" className="mt-1 w-full">
          ابدأ استخدام راصد
        </Button>
      </form>
    </AuthCard>
  );
}
