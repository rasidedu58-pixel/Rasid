"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Building2, CreditCard, ListChecks, Activity, UserCog, Receipt, Sparkles, Wallet, Menu } from "lucide-react";
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, cn } from "@academic-precision/ui";
import { hasPlatformPermission, type PlatformPermission } from "@academic-precision/contracts";
import { useWorkspace } from "../../lib/workspace-provider";
import { RasidWordmark } from "../brand/rasid-wordmark";
import { ThemeToggle } from "../theme-toggle";

const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutDashboard; permission: PlatformPermission }[] = [
  { href: "/platform-admin", label: "لوحة التحكم", icon: LayoutDashboard, permission: "platform.customers.view" },
  { href: "/platform-admin/follow-ups", label: "قائمة المتابعة", icon: ListChecks, permission: "platform.support.view" },
  { href: "/platform-admin/issues", label: "حالة المنصة والمشكلات", icon: Activity, permission: "platform.health.view" },
  { href: "/platform-admin/users", label: "المستخدمون", icon: Users, permission: "platform.customers.view" },
  { href: "/platform-admin/workspaces", label: "مساحات العمل", icon: Building2, permission: "platform.customers.view" },
  { href: "/platform-admin/billing", label: "مركز الفوترة", icon: Wallet, permission: "platform.billing.view" },
  { href: "/platform-admin/subscriptions", label: "الاشتراكات", icon: CreditCard, permission: "platform.subscriptions.view" },
  { href: "/platform-admin/payment-requests", label: "طلبات الدفع", icon: Receipt, permission: "platform.billing.view" },
  { href: "/platform-admin/custom-plans", label: "الباقات المخصصة", icon: Sparkles, permission: "platform.billing.view" },
  { href: "/platform-admin/staff", label: "فريق راصد", icon: UserCog, permission: "platform.staff.manage" },
];

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: typeof NAV_ITEMS;
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/platform-admin" && pathname?.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-shell-hover text-shell-text" : "text-shell-text-muted hover:bg-shell-hover/60 hover:text-shell-text",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/**
 * Dense operational shell for Rasid Platform Admin — deliberately distinct from
 * `AppShell` (the Teacher product's shell): no workspace switcher, a visibly
 * different (dark) chrome. Desktop shows the fixed sidebar (RTL: right edge);
 * mobile/tablet get a top bar + a right-anchored nav drawer (RTL) so the admin
 * can actually navigate on a phone. Theme toggle reuses the app's single theme
 * source on every breakpoint.
 */
export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { platformRole } = useWorkspace();
  // UX-only nav filtering — the server enforces the same permission on every
  // route, so a hidden item is still refused if reached by URL.
  const navItems = NAV_ITEMS.filter((item) => hasPlatformPermission(platformRole, item.permission));
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-[100dvh] w-60 shrink-0 flex-col gap-1 self-start overflow-y-auto bg-shell p-4 md:flex">
        <div className="mb-6 flex items-start justify-between gap-2 px-2">
          <div className="flex flex-col gap-1.5">
            <RasidWordmark variant="default" tone="onDark" />
            <span className="ps-[42px] text-xs text-shell-text-muted">Platform Admin</span>
          </div>
          <ThemeToggle className="shrink-0 text-shell-text-muted hover:bg-shell-hover hover:text-shell-text" />
        </div>
        <NavLinks items={navItems} pathname={pathname} />
        <div className="mt-auto px-2 pt-4">
          <Link href="/dashboard" className="text-xs text-shell-text-muted transition-colors hover:text-shell-text">
            العودة لراصد
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile/tablet: top bar with a menu button (opens the right-side drawer) + theme toggle. */}
        <div className="flex items-center justify-between border-b border-shell-border bg-shell px-3 py-3 text-white md:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setNavOpen(true)} aria-label="فتح القائمة" className="shrink-0 text-shell-text-muted hover:bg-shell-hover hover:text-shell-text">
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
            <span className="flex min-w-0 items-center gap-2 text-sm font-bold">
              <RasidWordmark variant="compact" tone="onDark" />
              <span className="truncate text-shell-text-muted">— Platform Admin</span>
            </span>
          </div>
          <ThemeToggle className="shrink-0 text-shell-text-muted hover:bg-shell-hover hover:text-shell-text" />
        </div>
        <main className="mx-auto w-full max-w-6xl overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>

      {/* Mobile/tablet nav drawer — opens from the RIGHT (inline-start under RTL). */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="start" className="w-72 max-w-[85vw] border-shell-border bg-shell" closeClassName="text-shell-text-muted hover:text-shell-text">
          <SheetHeader>
            <SheetTitle>
              <span className="flex items-center gap-2">
                <RasidWordmark variant="default" tone="onDark" />
                <span className="text-xs font-normal text-shell-text-muted">Platform Admin</span>
              </span>
            </SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1">
            <NavLinks items={navItems} pathname={pathname} onNavigate={() => setNavOpen(false)} />
            <Link href="/dashboard" onClick={() => setNavOpen(false)} className="mt-2 rounded-md px-3 py-2 text-xs text-shell-text-muted transition-colors hover:bg-shell-hover/60 hover:text-shell-text">
              العودة لراصد
            </Link>
          </nav>
        </SheetContent>
      </Sheet>
    </div>
  );
}
