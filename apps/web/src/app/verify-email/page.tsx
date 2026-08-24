"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Button } from "@academic-precision/ui";
import { getSupabaseClient } from "../../lib/supabase-client";
import { AuthCard } from "../../components/auth/auth-card";

/**
 * Landing page after signup — verification itself happens via Supabase's
 * own emailed link (there is no in-app OTP/code entry, per §9's explicit
 * "no OTP" rule); this page only confirms what happened and offers to
 * resend, never claims delivery/read status it cannot know.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");

  async function handleResend() {
    if (!email) return;
    setResendState("sending");
    try {
      await getSupabaseClient().auth.resend({ type: "signup", email });
    } finally {
      setResendState("sent");
    }
  }

  return (
    <AuthCard
      title="تحقق من بريدك الإلكتروني"
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
        <p className="text-sm text-text-secondary">
          أرسلنا رابط تفعيل إلى{" "}
          {email ? <span className="font-medium text-text-primary">{email}</span> : "بريدك الإلكتروني"}. افتح الرابط لتفعيل حسابك، ثم سجّل الدخول.
        </p>
        {email ? (
          <Button variant="outline" size="sm" onClick={handleResend} loading={resendState === "sending"} disabled={resendState === "sent"}>
            {resendState === "sent" ? "تم إرسال الرابط مجددًا" : "إعادة إرسال رابط التفعيل"}
          </Button>
        ) : null}
      </div>
    </AuthCard>
  );
}
