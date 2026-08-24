import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthGuard } from "../../components/auth/auth-guard";
import { AppShell } from "../../components/shell/app-shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <AppShell>{children}</AppShell>
    </AuthGuard>
  );
}
