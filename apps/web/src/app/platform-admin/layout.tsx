import type { Metadata } from "next";
import type { ReactNode } from "react";
import { RequireSession } from "../../components/platform-admin/require-session";
import { PlatformAdminShell } from "../../components/platform-admin/platform-admin-shell";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PlatformAdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <PlatformAdminShell>{children}</PlatformAdminShell>
    </RequireSession>
  );
}
