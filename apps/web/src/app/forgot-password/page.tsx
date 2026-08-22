"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getSupabaseClient } from "../../lib/supabase-client";

type RecoveryState = "idle" | "loading" | "sent" | "network-error";

const GENERIC_SENT_MESSAGE = "إذا كان الحساب موجودًا سنرسل تعليمات الاستعادة عند الإمكان.";

/**
 * Forgot-password shell (PRD §29.2). Always shows the same generic
 * confirmation regardless of whether the email is registered — this is a
 * deliberate no-account-existence-leak, not a bug: the UI copy and the
 * request outcome are identical for existing and non-existing identifiers.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<RecoveryState>("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");

    try {
      const supabase = getSupabaseClient();
      // Intentionally ignore the resolved `error`/`data` distinction for
      // "unknown identifier" — Supabase itself does not leak existence for
      // this call, and neither does this UI.
      await supabase.auth.resetPasswordForEmail(email);
      setState("sent");
    } catch {
      setState("network-error");
    }
  }

  if (state === "sent") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">تم إرسال التعليمات</h1>
        <p className="text-slate-600">{GENERIC_SENT_MESSAGE}</p>
        <Link href="/login" className="text-blue-600 underline">
          العودة لتسجيل الدخول
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">استعادة كلمة المرور</h1>
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

        {state === "network-error" ? (
          <p className="text-sm text-red-600">تعذر الاتصال بالخادم. حاول مرة أخرى.</p>
        ) : null}

        <button
          type="submit"
          disabled={state === "loading"}
          className="rounded bg-slate-900 p-2 text-white disabled:opacity-50"
        >
          {state === "loading" ? "جارٍ الإرسال..." : "إرسال تعليمات الاستعادة"}
        </button>
      </form>
      <Link href="/login" className="text-sm text-blue-600 underline">
        العودة لتسجيل الدخول
      </Link>
    </main>
  );
}
