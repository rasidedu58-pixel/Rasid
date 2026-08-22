"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabaseClient } from "../../lib/supabase-client";

type SignupState =
  | "idle"
  | "loading"
  | "verification-pending"
  | "invalid-code"
  | "duplicate-identity"
  | "network-error";

/**
 * Owner sign-up shell (PRD §29.1). Email + password only in V1; email
 * verification is mandatory and configured server-side in the Supabase
 * project — this page only triggers signUp and shows the resulting state.
 * User/Workspace/Owner Membership creation happens on the backend on the
 * first authenticated request from the verified identity (see apps/api
 * identity module), not here.
 */
export default function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<SignupState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    if (!fullName.trim()) {
      setState("invalid-code");
      setErrorMessage("الاسم الكامل مطلوب.");
      return;
    }

    setState("loading");

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (error) {
        if (/registered|exists|duplicate/i.test(error.message)) {
          setState("duplicate-identity");
          setErrorMessage("هذا البريد الإلكتروني مسجل بالفعل.");
          return;
        }
        setState("network-error");
        setErrorMessage(error.message);
        return;
      }

      if (data.user && !data.session) {
        setState("verification-pending");
        return;
      }

      setState("verification-pending");
    } catch {
      setState("network-error");
      setErrorMessage("تعذر الاتصال بالخادم. حاول مرة أخرى.");
    }
  }

  if (state === "verification-pending") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">تم إنشاء مساحة عملك</h1>
        <p className="text-slate-600">
          أرسلنا رابط تفعيل إلى بريدك الإلكتروني. يرجى فتحه لتأكيد الحساب قبل تسجيل الدخول.
        </p>
        <Link href="/login" className="text-blue-600 underline">
          العودة لتسجيل الدخول
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">إنشاء مساحة عمل جديدة</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <label className="flex flex-col gap-1 text-sm">
          الاسم الكامل
          <input
            className="rounded border border-slate-300 p-2"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </label>
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
            minLength={8}
            required
          />
        </label>

        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

        <button
          type="submit"
          disabled={state === "loading"}
          className="rounded bg-slate-900 p-2 text-white disabled:opacity-50"
        >
          {state === "loading" ? "جارٍ الإنشاء..." : "إنشاء الحساب"}
        </button>
      </form>
      <p className="text-sm text-slate-600">
        لديك حساب بالفعل؟{" "}
        <Link href="/login" className="text-blue-600 underline">
          تسجيل الدخول
        </Link>
      </p>
    </main>
  );
}
