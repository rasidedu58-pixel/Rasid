"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoadingRegion } from "@academic-precision/ui";
import { useSession } from "../../lib/session-provider";

/**
 * UI-only gate: redirects a signed-out visitor to `/login`. This is NOT
 * the real authorization boundary — every `/platform-admin/*` page still
 * calls the real API, which enforces `PlatformAdminGuard` server-side and
 * returns a plain 403 for anyone not on the `platform_admins` allowlist
 * (rendered as `PermissionDeniedState` by each page). This component only
 * avoids showing an authenticated-shell flash to someone with no session
 * at all.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status === "loading" || status === "unauthenticated") {
    return <LoadingRegion className="min-h-screen" />;
  }

  return <>{children}</>;
}
