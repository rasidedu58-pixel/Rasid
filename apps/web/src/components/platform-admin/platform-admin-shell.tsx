"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Building2, CreditCard } from "lucide-react";
import { cn } from "@academic-precision/ui";

const NAV_ITEMS = [
  { href: "/platform-admin", label: "لوحة التحكم", icon: LayoutDashboard },
  { href: "/platform-admin/users", label: "المستخدمون", icon: Users },
  { href: "/platform-admin/workspaces", label: "مساحات العمل", icon: Building2 },
  { href: "/platform-admin/subscriptions", label: "الاشتراكات", icon: CreditCard },
];

/**
 * Dense, desktop-first operational shell for Rasid Platform Admin —
 * deliberately distinct from `AppShell` (the Teacher product's own shell):
 * no workspace switcher, no tenant nav, a visibly different (dark sidebar)
 * chrome so nobody mistakes this for a tenant screen mid-session.
 */
export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col gap-1 bg-shell p-4 md:flex">
        <div className="mb-6 px-2">
          <span className="text-lg font-bold text-white">راصد</span>
          <p className="text-xs text-shell-text-muted">Platform Admin</p>
        </div>
        {NAV_ITEMS.map((item) => {
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
          <span className="text-sm font-bold">راصد — Platform Admin</span>
        </div>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
