"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoadingRegion, ErrorState } from "@academic-precision/ui";
import { shouldForceTeacherOnboarding } from "@academic-precision/contracts";
import { useSession } from "../../lib/session-provider";
import { useWorkspace } from "../../lib/workspace-provider";

/**
 * The one shared guard every authenticated route renders through (replaces
 * the pre-Phase-11 pattern of each page re-deriving its own
 * `supabase.auth.getSession()` effect). Centralizes: no session -> /login,
 * session but no completed-onboarding workspace -> /onboarding, workspace
 * context failed to load -> a real ErrorState with retry (never a blank
 * screen).
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const workspace = useWorkspace();

  useEffect(() => {
    if (sessionStatus === "unauthenticated") router.replace("/login");
  }, [sessionStatus, router]);

  // Mandatory Step-2 onboarding: an OWNER (teacher) whose workspace is ready
  // but whose profile is incomplete is routed to /onboarding. Deliberately NOT
  // triggered by `no-workspace` — a platform-staff user without a tenant
  // workspace must never be forced into teacher onboarding (item 15). Refresh
  // resumes from the same place because it re-derives from `/me`.
  useEffect(() => {
    if (
      sessionStatus === "authenticated" &&
      shouldForceTeacherOnboarding({
        workspaceReady: workspace.status === "ready",
        isOwner: workspace.isOwner,
        isPlatformStaff: workspace.isPlatformStaff,
        profileCompleted: workspace.profileCompleted,
      })
    ) {
      router.replace("/onboarding");
    }
  }, [sessionStatus, workspace.status, workspace.isOwner, workspace.isPlatformStaff, workspace.profileCompleted, router]);

  // Phase 15: this guard now renders INSIDE the AppShell content region
  // (see (app)/layout.tsx) — loading/error states are content-area sized,
  // not full-screen, so the shell chrome stays visible and stable.
  if (sessionStatus === "loading" || sessionStatus === "unauthenticated") {
    return <LoadingRegion className="min-h-[60vh]" />;
  }

  if (workspace.status === "loading" || workspace.status === "no-workspace") {
    return <LoadingRegion className="min-h-[60vh]" label="جارٍ تجهيز مساحة العمل..." />;
  }

  if (workspace.status === "error") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <ErrorState title="تعذّر تحميل بيانات مساحة العمل" onRetry={workspace.refetch} />
      </div>
    );
  }

  return <>{children}</>;
}
