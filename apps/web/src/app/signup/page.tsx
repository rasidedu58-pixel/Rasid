"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@academic-precision/ui";
import { EGYPT_GOVERNORATES, TEACHING_SUBJECTS, normalizeEgyptianPhone } from "@academic-precision/contracts";
import { getSupabaseClient } from "../../lib/supabase-client";
import { AuthCard } from "../../components/auth/auth-card";
import { PasswordInput } from "../../components/auth/password-input";

type SignupState = "idle" | "loading" | "error";

/**
 * Owner sign-up (PRD §29.1). V1 = Egypt. The account is not created until the
 * teacher provides name + email + password + phone + governorate + subject —
 * these are carried in Supabase `user_metadata` and backfilled into the teacher
 * profile at server-side provisioning (never overwriting a later edit). Email
 * verification is mandatory; this page triggers signUp then hands off to
 * `/verify-email`. A `returnTo` is preserved through the verify-then-continue chain.
 */
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnToParam = searchParams.get("returnTo");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [subject, setSubject] = useState("");
  const [subjectOther, setSubjectOther] = useState("");
  const [state, setState] = useState<SignupState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const next: Record<string, string> = {};
    if (!fullName.trim()) next.fullName = "الاسم الكامل مطلوب.";
    if (password.length < 8) next.password = "كلمة المرور يجب ألا تقل عن 8 أحرف.";
    const normalizedPhone = normalizeEgyptianPhone(phone);
    if (!phone.trim()) next.phone = "رقم الهاتف مطلوب.";
    else if (!normalizedPhone) next.phone = "أدخل رقم هاتف مصري صحيح (مثال: 01012345678).";
    if (!governorate) next.governorate = "المحافظة مطلوبة.";
    if (!subject) next.subject = "المادة مطلوبة.";
    if (subject === "OTHER" && !subjectOther.trim()) next.subjectOther = "اكتب اسم المادة.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setState("loading");

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: normalizedPhone,
            governorate,
            subject,
            subject_other: subject === "OTHER" ? subjectOther.trim() : "",
          },
        },
      });

      if (error) {
        if (/registered|exists|duplicate/i.test(error.message)) {
          setState("error");
          setErrorMessage("هذا البريد الإلكتروني مسجل بالفعل.");
          return;
        }
        setState("error");
        setErrorMessage(error.message);
        return;
      }

      const verifyQuery = returnToParam
        ? `?email=${encodeURIComponent(email)}&returnTo=${encodeURIComponent(returnToParam)}`
        : `?email=${encodeURIComponent(email)}`;
      router.push(`/verify-email${verifyQuery}`);
    } catch {
      setState("error");
      setErrorMessage("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    }
  }

  return (
    <AuthCard
      title="إنشاء مساحة عمل جديدة"
      description="لإدارة مجموعاتك وطلابك بشكل احترافي."
      footer={
        <span>
          لديك حساب بالفعل؟{" "}
          <Link href={returnToParam ? `/login?returnTo=${encodeURIComponent(returnToParam)}` : "/login"} className="font-medium text-brand hover:underline">
            تسجيل الدخول
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="الاسم الكامل" htmlFor="fullName" error={errors.fullName}>
          <Input id="fullName" type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} invalid={!!errors.fullName} required />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="كلمة المرور" htmlFor="password" hint="8 أحرف على الأقل." error={errors.password}>
          <PasswordInput id="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required invalid={!!errors.password} />
        </Field>
        <Field label="رقم الهاتف" htmlFor="phone" hint="رقم مصري، مثال: 01012345678." error={errors.phone}>
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} invalid={!!errors.phone} required />
        </Field>
        <Field label="المحافظة" htmlFor="governorate" error={errors.governorate}>
          <Select value={governorate} onValueChange={setGovernorate}>
            <SelectTrigger id="governorate" aria-invalid={!!errors.governorate}>
              <SelectValue placeholder="اختر المحافظة" />
            </SelectTrigger>
            <SelectContent>
              {EGYPT_GOVERNORATES.map((g) => (
                <SelectItem key={g.code} value={g.code}>{g.ar}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="المادة التي تدرّسها" htmlFor="subject" error={errors.subject}>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger id="subject" aria-invalid={!!errors.subject}>
              <SelectValue placeholder="اختر المادة" />
            </SelectTrigger>
            <SelectContent>
              {TEACHING_SUBJECTS.map((s) => (
                <SelectItem key={s.code} value={s.code}>{s.ar}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {subject === "OTHER" ? (
          <Field label="اسم المادة" htmlFor="subjectOther" error={errors.subjectOther}>
            <Input id="subjectOther" type="text" value={subjectOther} onChange={(e) => setSubjectOther(e.target.value)} invalid={!!errors.subjectOther} required />
          </Field>
        ) : null}

        {errorMessage ? (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={state === "loading"} className="mt-1 w-full">
          إنشاء الحساب
        </Button>
      </form>
    </AuthCard>
  );
}
