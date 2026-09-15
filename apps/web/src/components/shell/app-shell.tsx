"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { MobileNav } from "./mobile-nav";
import { EntitlementBanner } from "./entitlement-banner";
import { GuidedSetupLauncher } from "../onboarding/guided-setup-launcher";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <EntitlementBanner />
        <main className="flex-1 overflow-x-hidden px-4 py-5 md:px-8 md:py-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <MobileNav open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      {/* Persistent guided-setup companion — renders itself only for
          Owners whose workspace has not yet cleared the 5 setup steps
          (and remembers a permanent-dismiss decision after completion). */}
      <GuidedSetupLauncher />
    </div>
  );
}
