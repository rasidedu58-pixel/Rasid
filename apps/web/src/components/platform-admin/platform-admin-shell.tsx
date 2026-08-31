"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Building2, CreditCard, ListChecks, Activity, UserCog } from "lucide-react";
import { cn } from "@academic-precision/ui";
import { hasPlatformPermission, type PlatformPermission } from "@academic-precision/contracts";
import { useWorkspace } from "../../lib/workspace-provider";
import { RasidWordmark } from "../brand/rasid-wordmark";

const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutDashboard; permission: PlatformPermission }[] = [
  { href: "/platform-admin", label: "لوحة التحكم", icon: LayoutDashboard, permission: "platform.customers.view" },
  { href: "/platform-admin/follow-ups", label: "قائمة المتابعة", icon: ListChecks, permission: "platform.support.view" },
  { href: "/platform-admin/issues", label: "حالة المنصة والمشكلات", icon: Activity, permission: "platform.health.view" },
  { href: "/platform-admin/users", label: "المستخدمون", icon: Users, permission: "platform.customers.view" },
  { href: "/platform-admin/workspaces", label: "مساحات العمل", icon: Building2, permission: "platform.customers.view" },
  { href: "/platform-admin/subscriptions", label: "الاشتراكات", icon: CreditCard, permission: "platform.subscriptions.view" },
  { href: "/platform-admin/staff", label: "فريق راصد", icon: UserCog, permission: "platform.staff.manage" },
];

/**
 * Dense, desktop-first operational shell for Rasid Platform Admin —
 * deliberately distinct from `AppShell` (the Teacher product's own shell):
 * no workspace switcher, no tenant nav, a visibly different (dark sidebar)
 * chrome so nobody mistakes this for a tenant screen mid-session.
 */
export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { platformRole } = useWorkspace();
  // UX-only nav filtering — the server enforces the same permission on every
  // route, so a hidden item is still refused if reached by URL.
  const navItems = NAV_ITEMS.filter((item) => hasPlatformPermission(platformRole, item.permission));

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col gap-1 self-start overflow-y-auto bg-shell p-4 md:flex">
        <div className="mb-6 flex flex-col gap-1.5 px-2">
          <RasidWordmark variant="default" tone="onDark" />
          <span className="ps-[42px] text-xs text-shell-text-muted">Platform Admin</span>
        </div>
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== "/platform-admin" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-shell-hover text-shell-text" : "text-shell-text-muted hover:bg-shell-hover/60 hover:text-shell-text",
              )}
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <div className="mt-auto px-2 pt-4">
          <Link href="/dashboard" className="text-xs text-shell-text-muted transition-colors hover:text-shell-text">
            العودة لراصد
          </Link>
        </div>
      </aside>

      <div className="flex-1">
        {/* Mobile: a simple top bar instead of the sidebar — critical lookups only, per §L. */}
        <div className="flex items-center justify-between border-b border-shell-border bg-shell px-4 py-3 text-white md:hidden">
          <span className="flex items-center gap-2 text-sm font-bold">
            <RasidWordmark variant="compact" tone="onDark" />
            <span className="text-shell-text-muted">— Platform Admin</span>
          </span>
        </div>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
