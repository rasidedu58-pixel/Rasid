"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "../../lib/supabase-client";

type LoginState = "idle" | "loading" | "authenticated" | "expired" | "locked" | "error";

/**
 * Login shell (PRD §29.2). Generic error messaging — never confirms
 * whether an identifier exists. Session expiry is surfaced via the
 * `?expired=1` query param (set by protected pages when a server call
 * returns SESSION_EXPIRED), redirecting the user here without claiming an
 * unsaved write succeeded.
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
      setState("expired");
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

      setState("authenticated");
      router.push("/onboarding");
    } catch {
      setState("error");
      setErrorMessage("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">تسجيل الدخول</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1 text-sm">
          البريد الإلكتروني
          <input
            className="rounded border border-slate-300 p-2"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          كلمة المرور
          <input
            className="rounded border border-slate-300 p-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        <button
          type="submit"
          disabled={state === "loading"}
          className="rounded bg-slate-900 p-2 text-white disabled:opacity-50"
        >
          {state === "loading" ? "جارٍ الدخول..." : "دخول"}
        </button>
      </form>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-blue-600 underline">
          نسيت كلمة المرور؟
        </Link>
        <Link href="/signup" className="text-blue-600 underline">
          إنشاء حساب جديد
        </Link>
      </div>
    </main>
  );
}
