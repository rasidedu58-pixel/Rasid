"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button, Field } from "@academic-precision/ui";
import { getSupabaseClient } from "../../lib/supabase-client";
import { AuthCard } from "../../components/auth/auth-card";
import { PasswordInput } from "../../components/auth/password-input";

type ResetState = "idle" | "loading" | "success" | "error";

/**
 * Landing page for the link `forgot-password`'s `resetPasswordForEmail`
 * sends. Supabase's browser client (`detectSessionInUrl: true`) exchanges
 * the URL's recovery token for a session automatically on load; this page
 * only needs to call `updateUser({password})` against that session.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [state, setState] = useState<ResetState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setFieldError(null);

    if (password.length < 8) {
      setFieldError("كلمة المرور يجب ألا تقل عن 8 أحرف.");
      return;
    }
    if (password !== confirmPassword) {
      setFieldError("كلمتا المرور غير متطابقتين.");
      return;
    }

    setState("loading");
    try {
      const { error } = await getSupabaseClient().auth.updateUser({ password });
      if (error) {
        setState("error");
        setErrorMessage("انتهت صلاحية الرابط أو أنه غير صالح. أعد طلب رابط جديد.");
        return;
      }
      setState("success");
    } catch {
      setState("error");
      setErrorMessage("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    }
  }

  if (state === "success") {
    return (
      <AuthCard title="تم تحديث كلمة المرور">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
            <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />
          </div>
          <p className="text-sm text-text-secondary">يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.</p>
          <Button className="w-full" onClick={() => router.push("/login")}>
            الذهاب لتسجيل الدخول
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="تعيين كلمة مرور جديدة">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="كلمة المرور الجديدة" htmlFor="password" hint="8 أحرف على الأقل." error={fieldError ?? undefined}>
          <PasswordInput id="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required invalid={!!fieldError} />
        </Field>
        <Field label="تأكيد كلمة المرور" htmlFor="confirmPassword">
          <PasswordInput id="confirmPassword" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </Field>

        {errorMessage ? (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={state === "loading"} className="mt-1 w-full">
          حفظ كلمة المرور
        </Button>
      </form>
    </AuthCard>
  );
}
