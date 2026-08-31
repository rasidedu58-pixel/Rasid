"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Button, toast } from "@academic-precision/ui";
import { PLATFORM_ROLE_LABEL } from "../../../lib/platform-labels";
import { AuthCard } from "../../../components/auth/auth-card";
import { useSession } from "../../../lib/session-provider";
import { ApiRequestError } from "../../../lib/api/client";
import { acceptStaffInvitation, previewStaffInvitation } from "../../../lib/api/platform-invitations";

/**
 * Platform staff invitation acceptance — outside the platform-admin shell (the
 * accepter is not a platform admin yet). The token is the authority; accepting
 * INSERTs the staff member's platform_admins row server-side.
 */
export default function JoinPlatformPage() {
  const params = useParams();
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? "";
  const router = useRouter();
  const { status: sessionStatus } = useSession();

  if (sessionStatus === "loading") return <CenteredSpinner label="جارٍ التحقق من جلستك…" />;

  if (sessionStatus === "unauthenticated") {
    const returnTo = encodeURIComponent(`/join-platform/${encodeURIComponent(token)}`);
    return (
      <AuthCard title="دعوة للانضمام لفريق راصد" description="سجّل الدخول بالبريد المدعو لقبول الدعوة.">
        <div className="flex flex-col gap-3">
          <Button size="lg" className="w-full" onClick={() => router.push(`/login?returnTo=${returnTo}`)}>
            تسجيل الدخول
          </Button>
          <Button size="lg" variant="outline" className="w-full" onClick={() => router.push(`/signup?returnTo=${returnTo}`)}>
            إنشاء حساب جديد
          </Button>
        </div>
      </AuthCard>
    );
  }

  return <AuthenticatedAccept token={token} onDone={() => router.replace("/platform-admin")} />;
}

function AuthenticatedAccept({ token, onDone }: { token: string; onDone: () => void }) {
  const preview = useQuery({ queryKey: ["staff-invite-preview", token], queryFn: () => previewStaffInvitation(token), enabled: !!token, retry: false });
  // NOTE: we deliberately do NOT call /me here — that triggers tenant lazy
  // provisioning (workspace + owner membership + trial), which a Platform Staff
  // member must never get. The accept endpoint ensures ONLY the application
  // users row server-side (ensureApplicationUser) before inserting platform_admins.
  const accept = useMutation({
    mutationFn: () => acceptStaffInvitation(token),
    onSuccess: () => {
      toast.success("تم قبول الدعوة — أهلًا بك في فريق راصد");
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === "FORBIDDEN") {
        toast.error(e.message || "تعذّر قبول الدعوة");
        return;
      }
      toast.error("تعذّر قبول الدعوة");
    },
  });

  if (preview.isLoading) return <CenteredSpinner label="جارٍ تحميل الدعوة…" />;

  const invalid = preview.isError || !preview.data || !preview.data.valid;
  if (invalid) {
    return (
      <AuthCard title="رابط الدعوة غير صالح">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle">
            <XCircle className="h-6 w-6 text-danger" aria-hidden />
          </div>
          <p className="text-sm text-text-secondary">هذه الدعوة انتهت أو استُخدمت أو أُلغيت. اطلب رابطًا جديدًا من مالك المنصة.</p>
        </div>
      </AuthCard>
    );
  }

  const roleLabel = PLATFORM_ROLE_LABEL[preview.data.role] ?? preview.data.role;
  return (
    <AuthCard title="دعوة للانضمام لفريق راصد" description={`ستنضم بدور «${roleLabel}».`}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-subtle">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">فريق تشغيل راصد</p>
            <p className="text-xs text-text-secondary" dir="ltr">{preview.data.email}</p>
          </div>
        </div>
        <Button size="lg" className="w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
          قبول الدعوة والانضمام
        </Button>
        <p className="text-center text-xs text-text-tertiary">سجّل الدخول بالبريد المدعو أعلاه.</p>
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
