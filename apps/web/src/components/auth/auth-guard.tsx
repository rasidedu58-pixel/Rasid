"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoadingRegion, ErrorState } from "@academic-precision/ui";
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

  useEffect(() => {
    if (sessionStatus === "authenticated" && workspace.status === "no-workspace") router.replace("/onboarding");
  }, [sessionStatus, workspace.status, router]);

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
