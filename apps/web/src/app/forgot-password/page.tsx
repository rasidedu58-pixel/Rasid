"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button, Field, Input } from "@academic-precision/ui";
import { getSupabaseClient } from "../../lib/supabase-client";
import { env } from "../../env";
import { AuthCard } from "../../components/auth/auth-card";

type RecoveryState = "idle" | "loading" | "sent" | "network-error";

const GENERIC_SENT_MESSAGE = "إذا كان الحساب موجودًا سنرسل تعليمات الاستعادة عند الإمكان.";

/**
 * Forgot-password (PRD §29.2). Always shows the same generic confirmation
 * regardless of whether the email is registered — a deliberate
 * no-account-existence-leak, not a bug.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<RecoveryState>("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("loading");

    try {
      const supabase = getSupabaseClient();
      const redirectTo = env.NEXT_PUBLIC_APP_URL ? `${env.NEXT_PUBLIC_APP_URL}/reset-password` : undefined;
      // Intentionally ignore the resolved error/data distinction for
      // "unknown identifier" — Supabase itself does not leak existence for
      // this call, and neither does this UI.
      await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
      setState("sent");
    } catch {
      setState("network-error");
    }
  }

  if (state === "sent") {
    return (
      <AuthCard
        title="تم إرسال التعليمات"
        footer={
          <Link href="/login" className="font-medium text-brand hover:underline">
            العودة لتسجيل الدخول
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle">
            <MailCheck className="h-6 w-6 text-brand" aria-hidden />
          </div>
          <p className="text-sm text-text-secondary">{GENERIC_SENT_MESSAGE}</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="استعادة كلمة المرور"
      description="أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين."
      footer={
        <Link href="/login" className="font-medium text-brand hover:underline">
          العودة لتسجيل الدخول
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="البريد الإلكتروني" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>

        {state === "network-error" ? (
          <p className="text-sm text-danger" role="alert">
            تعذّر الاتصال بالخادم. حاول مرة أخرى.
          </p>
        ) : null}

        <Button type="submit" size="lg" loading={state === "loading"} className="w-full">
          إرسال تعليمات الاستعادة
        </Button>
      </form>
    </AuthCard>
  );
}
