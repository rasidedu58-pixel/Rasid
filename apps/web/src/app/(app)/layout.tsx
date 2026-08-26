import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthGuard } from "../../components/auth/auth-guard";
import { AppShell } from "../../components/shell/app-shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Phase 15 latency fix — AppShell now wraps AuthGuard (was the reverse),
 * so the shell chrome (sidebar/topbar) paints immediately on load instead
 * of a full-screen spinner blocking everything until the auth+workspace
 * waterfall resolves. AuthGuard still gates the CONTENT region: no page
 * component mounts before workspace context is ready, and the redirect
 * rules (no session → /login, no workspace → /onboarding) are unchanged.
 * Shell components already tolerate a loading workspace (nav items appear
 * when permissions arrive; topbar falls back to "راصد").
 */
export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <AuthGuard>{children}</AuthGuard>
    </AppShell>
  );
}
