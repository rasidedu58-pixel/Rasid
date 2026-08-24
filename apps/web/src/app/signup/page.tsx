"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@academic-precision/ui";
import { getSupabaseClient } from "../../lib/supabase-client";
import { AuthCard } from "../../components/auth/auth-card";

type SignupState = "idle" | "loading" | "error";

/**
 * Owner sign-up (PRD §29.1). Email + password only in V1; email
 * verification is mandatory (configured server-side in Supabase) — this
 * page only triggers signUp and hands off to `/verify-email`.
 * User/Workspace/Owner Membership creation happens server-side on the
 * first authenticated request from the verified identity, not here.
 */
export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<SignupState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldError(null);

    if (!fullName.trim()) {
      setFieldError("الاسم الكامل مطلوب.");
      return;
    }
    if (password.length < 8) {
      setFieldError("كلمة المرور يجب ألا تقل عن 8 أحرف.");
      return;
    }

    setState("loading");

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
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

      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
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
          <Link href="/login" className="font-medium text-brand hover:underline">
            تسجيل الدخول
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="الاسم الكامل" htmlFor="fullName">
          <Input id="fullName" type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="كلمة المرور" htmlFor="password" hint="8 أحرف على الأقل." error={fieldError ?? undefined}>
          <Input id="password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required invalid={!!fieldError} />
        </Field>

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
