"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@academic-precision/ui";
import { getSupabaseClient } from "../../lib/supabase-client";
import { AuthCard } from "../../components/auth/auth-card";

type LoginState = "idle" | "loading" | "locked" | "error";

/**
 * Login (PRD §29.2). Generic error messaging — never confirms whether an
 * identifier exists. Session expiry is surfaced via `?expired=1` (set by
 * `apiRequest` when the server returns SESSION_EXPIRED/401), without
 * claiming an unsaved write succeeded.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<LoginState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("expired") === "1") {
      setErrorMessage("انتهت الجلسة. يرجى تسجيل الدخول مجددًا.");
    }
  }, [searchParams]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setState("loading");

    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        if (/rate|too many/i.test(error.message)) {
          setState("locked");
          setErrorMessage("محاولات كثيرة. يرجى الانتظار قبل المحاولة مجددًا.");
          return;
        }
        setState("error");
        setErrorMessage("بيانات الدخول غير صحيحة.");
        return;
      }

      // The (app) route group's own AuthGuard resolves whether the caller
      // already has a completed workspace (-> /dashboard) or still needs
      // onboarding (-> redirected there itself) — login never guesses.
      router.push("/dashboard");
    } catch {
      setState("error");
      setErrorMessage("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    }
  }

  return (
    <AuthCard
      title="تسجيل الدخول"
      description="أدخل بيانات حسابك للمتابعة."
      footer={
        <span>
          ليس لديك حساب؟{" "}
          <Link href="/signup" className="font-medium text-brand hover:underline">
            إنشاء حساب جديد
          </Link>
        </span>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="البريد الإلكتروني" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="كلمة المرور" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>

        {errorMessage ? (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={state === "loading"} disabled={state === "locked"} className="mt-1 w-full">
          دخول
        </Button>

        <Link href="/forgot-password" className="text-center text-sm text-text-secondary hover:text-brand hover:underline">
          نسيت كلمة المرور؟
        </Link>
      </form>
    </AuthCard>
  );
}
