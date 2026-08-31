"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, PartyPopper, XCircle } from "lucide-react";
import { Button, toast } from "@academic-precision/ui";
import { AuthCard } from "../../../components/auth/auth-card";
import { useSession } from "../../../lib/session-provider";
import { qk } from "../../../lib/query-keys";
import { fetchMe } from "../../../lib/api/identity";
import { claimCustomerInvitation, previewCustomerInvitation } from "../../../lib/api/platform-invitations";

/**
 * Customer onboarding — the secure link the platform sends a new customer. The
 * customer signs up through the normal auth flow; on first arrival here their
 * account has been provisioned (workspace + trial) by lazy provisioning, and we
 * claim the invite (linking it to their workspace). The claim provisions
 * nothing itself.
 */
export default function WelcomePage() {
  const params = useParams();
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? "";
  const router = useRouter();
  const { status: sessionStatus } = useSession();

  if (sessionStatus === "loading") return <CenteredSpinner label="جارٍ التحقق من جلستك…" />;

  if (sessionStatus === "unauthenticated") {
    const returnTo = encodeURIComponent(`/welcome/${encodeURIComponent(token)}`);
    return (
      <AuthCard title="مرحبًا بك في راصد" description="أنشئ حسابك بالبريد المدعو للبدء.">
        <div className="flex flex-col gap-3">
          <Button size="lg" className="w-full" onClick={() => router.push(`/signup?returnTo=${returnTo}`)}>
            إنشاء حساب
          </Button>
          <Button size="lg" variant="outline" className="w-full" onClick={() => router.push(`/login?returnTo=${returnTo}`)}>
            لديّ حساب بالفعل
          </Button>
        </div>
      </AuthCard>
    );
  }

  return <AuthenticatedClaim token={token} onDone={() => router.replace("/dashboard")} />;
}

function AuthenticatedClaim({ token, onDone }: { token: string; onDone: () => void }) {
  const preview = useQuery({ queryKey: ["customer-invite-preview", token], queryFn: () => previewCustomerInvitation(token), enabled: !!token, retry: false });
  // Touch /me so lazy provisioning creates the workspace + trial before claiming.
  const me = useQuery({ queryKey: qk.me(), queryFn: fetchMe });
  const ready = me.status !== "pending";

  const claim = useMutation({
    mutationFn: () => claimCustomerInvitation(token),
    onSuccess: () => {
      toast.success("تم تفعيل حسابك — أهلًا بك في راصد");
      onDone();
    },
    onError: () => toast.error("تعذّر إكمال التفعيل. يمكنك المتابعة إلى لوحة التحكم."),
  });

  if (preview.isLoading) return <CenteredSpinner label="جارٍ تحميل الدعوة…" />;

  const invalid = preview.isError || !preview.data || !preview.data.valid;
  if (invalid) {
    return (
      <AuthCard title="رابط غير صالح">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle">
            <XCircle className="h-6 w-6 text-danger" aria-hidden />
          </div>
          <p className="text-sm text-text-secondary">انتهت صلاحية هذا الرابط أو استُخدم. تواصل مع فريق راصد لرابط جديد.</p>
          <Button variant="outline" className="w-full" onClick={onDone}>
            الذهاب إلى لوحة التحكم
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={`أهلًا ${preview.data.fullName}`} description="حسابك جاهز. أكمل التفعيل للبدء بفترتك التجريبية.">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-subtle">
            <PartyPopper className="h-5 w-5 text-brand" aria-hidden />
          </span>
          <p className="text-sm text-text-secondary">ستبدأ فترتك التجريبية تلقائيًا وفق سياسة راصد.</p>
        </div>
        <Button size="lg" className="w-full" loading={claim.isPending} disabled={!ready} onClick={() => claim.mutate()}>
          {ready ? "تفعيل حسابي والبدء" : "جارٍ تجهيز حسابك…"}
        </Button>
      </div>
    </AuthCard>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <AuthCard title="لحظة من فضلك">
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden />
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </AuthCard>
  );
}
