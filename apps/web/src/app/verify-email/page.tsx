"use client";

import { Suspense, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck, CheckCircle2 } from "lucide-react";
import { Button } from "@academic-precision/ui";
import { getSupabaseClient } from "../../lib/supabase-client";
import { useWorkspace } from "../../lib/workspace-provider";
import { AuthCard } from "../../components/auth/auth-card";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

type VerifyState = "idle" | "verifying" | "success";

/**
 * Landing page after signup. Verification is now an in-app 6-digit OTP
 * (the "Confirm signup" Supabase email template was switched server-side
 * to `{{ .Token }}`) rather than a clickable link — see
 * `apps/web/src/app/signup/page.tsx`'s comment for the handoff. Real API
 * verified directly against the installed `@supabase/auth-js@2.112.3`
 * types before writing this: `verifyOtp({ email, token, type: "email" })`
 * is the current (non-deprecated) type for a signup/sign-in email OTP —
 * `"signup"`/`"magiclink"` are explicitly documented as deprecated
 * `EmailOtpType` values in that same source. `resend({ type: "signup",
 * email })` is unchanged from before (it was already correct).
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const workspace = useWorkspace();

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending">("idle");
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Post-success routing reuses the SAME source of truth AuthGuard uses
  // (`useWorkspace().status`) — no new business logic here. `verifyOtp`
  // succeeding sets the Supabase session client-side, which SessionProvider
  // picks up via its existing `onAuthStateChange` listener; once that
  // flows through, WorkspaceProvider resolves "no-workspace" (new owner,
  // no onboarding yet) vs "ready" (workspace already provisioned) exactly
  // like it does for every other authenticated route.
  useEffect(() => {
    if (verifyState !== "success") return;
    if (workspace.status === "no-workspace") router.replace("/onboarding");
    else if (workspace.status === "ready") router.replace("/dashboard");
  }, [verifyState, workspace.status, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function focusInput(index: number) {
    inputRefs.current[index]?.focus();
  }

  function handleDigitChange(index: number, rawValue: string) {
    const value = rawValue.replace(/\D/g, "");
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value ? value.slice(-1) : "";
      return next;
    });
    if (value && index < OTP_LENGTH - 1) focusInput(index + 1);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      focusInput(index - 1);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void handleVerify();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!pasted) return;
    event.preventDefault();
    const next = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    focusInput(Math.min(pasted.length, OTP_LENGTH - 1));
  }

  const code = digits.join("");
  const canSubmit = code.length === OTP_LENGTH && verifyState !== "verifying";

  async function handleVerify() {
    if (!email || code.length !== OTP_LENGTH || verifyState === "verifying") return;
    setErrorMessage(null);
    setVerifyState("verifying");
    try {
      const { error } = await getSupabaseClient().auth.verifyOtp({ email, token: code, type: "email" });
      if (error) {
        setVerifyState("idle");
        setErrorMessage(mapOtpError(error.message));
        return;
      }
      setVerifyState("success");
    } catch {
      setVerifyState("idle");
      setErrorMessage("تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    }
  }

  async function handleResend() {
    if (!email || resendState === "sending" || cooldown > 0) return;
    setResendState("sending");
    setResendMessage(null);
    setErrorMessage(null);
    try {
      const { error } = await getSupabaseClient().auth.resend({ type: "signup", email });
      if (error) {
        setResendMessage("تعذّر إرسال الرمز. حاول مرة أخرى.");
      } else {
        setResendMessage("تم إرسال رمز جديد إلى بريدك الإلكتروني.");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    } catch {
      setResendMessage("تعذّر إرسال الرمز. حاول مرة أخرى.");
    } finally {
      setResendState("idle");
    }
  }

  if (!email) {
    return (
      <AuthCard
        title="تحقق من بريدك الإلكتروني"
        footer={
          <Link href="/signup" className="font-medium text-brand hover:underline">
            العودة لإنشاء حساب
          </Link>
        }
      >
        <p className="text-center text-sm text-text-secondary">
          تعذّر تحديد البريد الإلكتروني المطلوب تأكيده. أنشئ حسابًا جديدًا، أو سجّل الدخول إن كان حسابك مفعّلًا بالفعل.
        </p>
      </AuthCard>
    );
  }

  if (verifyState === "success") {
    return (
      <AuthCard title="تم تأكيد بريدك الإلكتروني">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
            <CheckCircle2 className="h-6 w-6 text-success" aria-hidden />
          </div>
          <p className="text-sm text-text-secondary">جارٍ تجهيز حسابك...</p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="تحقق من بريدك الإلكتروني"
      description={`أرسلنا رمزًا مكوّنًا من ${OTP_LENGTH} أرقام إلى ${email}`}
      footer={
        <Link href="/login" className="font-medium text-brand hover:underline">
          العودة لتسجيل الدخول
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-subtle">
          <MailCheck className="h-6 w-6 text-brand" aria-hidden />
        </div>

        <div dir="ltr" className="flex gap-2">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => {
                inputRefs.current[index] = el;
              }}
              aria-label={`رقم ${index + 1} من رمز التحقق`}
              inputMode="numeric"
              autoComplete={index === 0 ? "one-time-code" : "off"}
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigitChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              onPaste={handlePaste}
              className="h-12 w-10 rounded-md border border-border-strong bg-surface text-center text-lg font-semibold text-text-primary focus-ring"
            />
          ))}
        </div>

        {errorMessage ? (
          <p className="text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <Button size="lg" className="w-full" loading={verifyState === "verifying"} disabled={!canSubmit} onClick={() => void handleVerify()}>
          تأكيد البريد
        </Button>

        <div className="flex flex-col items-center gap-1">
          <Button variant="link" size="sm" onClick={() => void handleResend()} loading={resendState === "sending"} disabled={cooldown > 0}>
            {cooldown > 0 ? `إعادة إرسال الرمز (${cooldown})` : "إعادة إرسال الرمز"}
          </Button>
          {resendMessage ? <p className="text-xs text-text-tertiary">{resendMessage}</p> : null}
        </div>
      </div>
    </AuthCard>
  );
}

/** Best-effort Arabic mapping of Supabase's English GoTrue error strings — never surfaces the raw English message to the user. */
function mapOtpError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("expired")) return "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.";
  if (normalized.includes("invalid") || normalized.includes("token")) return "الرمز الذي أدخلته غير صحيح.";
  return "تعذّر تأكيد الرمز. حاول مرة أخرى.";
}
