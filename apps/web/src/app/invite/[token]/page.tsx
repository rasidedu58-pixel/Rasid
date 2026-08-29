"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck, XCircle, UserCheck, Loader2 } from "lucide-react";
import { Button, toast } from "@academic-precision/ui";
import type { PermissionKey } from "@academic-precision/contracts";
import { AuthCard } from "../../../components/auth/auth-card";
import { useSession } from "../../../lib/session-provider";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { ApiRequestError } from "../../../lib/api/client";
import { previewInvitation, acceptInvitation } from "../../../lib/api/invitations";
import { PERMISSION_LABEL } from "../../(app)/team/permission-catalog-ui";

/**
 * Public invitation-acceptance page (outside the `(app)` group, so the
 * workspace-requiring AuthGuard never fires). If the visitor is not signed in
 * we route them to login/signup with a `returnTo` back here; once
 * authenticated they preview the invite and accept. Acceptance creates their
 * membership atomically server-side; on success we invalidate `/me` so the new
 * workspace appears and head to the dashboard.
 */
export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const token = (Array.isArray(params.token) ? params.token[0] : params.token) ?? "";
  const { status: sessionStatus } = useSession();

  if (sessionStatus === "loading") {
    return <CenteredSpinner label="جارٍ التحقق من جلستك…" />;
  }

  if (sessionStatus === "unauthenticated") {
    const returnTo = encodeURIComponent(`/invite/${encodeURIComponent(token)}`);
    return (
      <AuthCard title="لقد دُعيت للانضمام" description="سجّل الدخول أو أنشئ حسابًا لقبول الدعوة والانضمام إلى الفريق.">
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

  return <AuthenticatedAccept token={token} />;
}

function AuthenticatedAccept({ token }: { token: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspace();
  // `/me` resolving (status leaving "loading") means this user has been
  // provisioned server-side — a prerequisite for the membership the accept
  // creates. Keep the accept button disabled until then.
  const accountReady = workspace.status !== "loading";

  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () => previewInvitation(token),
    enabled: !!token,
    retry: false,
  });

  // Lands the user directly in the invited workspace: make it their current
  // workspace, then wait for `/me` to include the new membership BEFORE routing
  // — so the dashboard resolves the invited (populated) workspace immediately,
  // never a flash of the user's own empty auto-provisioned one.
  async function goToInvitedWorkspace(invitedWorkspaceId: string) {
    workspace.setCurrentWorkspace(invitedWorkspaceId);
    await queryClient.refetchQueries({ queryKey: qk.me() });
    router.replace("/dashboard");
  }

  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: async (res) => {
      toast.success("تم قبول الدعوة — أهلًا بك في الفريق");
      await goToInvitedWorkspace(res.workspaceId);
    },
    onError: async (error) => {
      // Already a member → still route them straight into that workspace.
      if (error instanceof ApiRequestError && error.code === "ALREADY_MEMBER") {
        toast.info("أنت عضو بالفعل في هذه المساحة");
        if (preview.data) await goToInvitedWorkspace(preview.data.workspaceId);
        else router.replace("/dashboard");
        return;
      }
      toast.error("تعذّر قبول الدعوة");
    },
  });

  const permissionLabels = useMemo(
    () => (preview.data?.permissions ?? []).map((p) => PERMISSION_LABEL[p as PermissionKey] ?? p),
    [preview.data],
  );

  if (preview.isLoading) {
    return <CenteredSpinner label="جارٍ تحميل الدعوة…" />;
  }

  // A 404 (INVITATION_INVALID) or any invalid/expired/used invite → one clear state.
  const invalid = preview.isError || !preview.data || !preview.data.valid;
  if (invalid) {
    return (
      <AuthCard title="رابط الدعوة غير صالح">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-danger-subtle">
            <XCircle className="h-6 w-6 text-danger" aria-hidden />
          </div>
          <p className="text-sm text-text-secondary">
            هذه الدعوة انتهت صلاحيتها أو تم استخدامها أو إلغاؤها. اطلب رابط دعوة جديدًا من صاحب مساحة العمل.
          </p>
          <Button variant="outline" className="w-full" onClick={() => router.replace("/dashboard")}>
            الذهاب إلى لوحة التحكم
          </Button>
        </div>
      </AuthCard>
    );
  }

  const workspaceName = preview.data.workspaceName ?? "فريق على راصد";

  return (
    <AuthCard title="دعوة للانضمام" description={`لقد دُعيت للانضمام إلى «${workspaceName}».`}>
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-subtle">
            <UserCheck className="h-5 w-5 text-brand" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">{workspaceName}</p>
            <p className="text-xs text-text-secondary">ستنضم كعضو بصلاحيات محددة.</p>
          </div>
        </div>

        {permissionLabels.length > 0 ? (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              ما ستتمكن من الوصول إليه
            </p>
            <div className="flex flex-wrap gap-1.5">
              {permissionLabels.map((label) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-subtle/50 px-2.5 py-1 text-xs text-brand-subtle-foreground"
                >
                  <CheckCircle2 className="h-3 w-3" aria-hidden />
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <Button size="lg" className="w-full" loading={accept.isPending} disabled={!accountReady} onClick={() => accept.mutate()}>
          {accountReady ? "قبول الدعوة والانضمام" : "جارٍ تجهيز حسابك…"}
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
