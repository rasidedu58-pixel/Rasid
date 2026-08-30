"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bell, LogOut, Menu, Shield, User } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initialsFromName,
} from "@academic-precision/ui";
import { useWorkspace } from "../../lib/workspace-provider";
import { qk } from "../../lib/query-keys";
import { fetchNotifications } from "../../lib/api/reports";
import { getSupabaseClient } from "../../lib/supabase-client";
import { SubscriptionStatusBadge } from "../billing/subscription-status-badge";
import { ThemeToggle } from "../theme-toggle";

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { workspaceId, workspaceName, subscriptionState, isPlatformStaff } = useWorkspace();

  const notificationsQuery = useQuery({
    queryKey: workspaceId ? qk.notifications.list(workspaceId) : ["notifications", "none"],
    queryFn: () => fetchNotifications(workspaceId!),
    enabled: !!workspaceId,
    refetchInterval: 60_000,
  });

  async function handleSignOut() {
    await getSupabaseClient().auth.signOut();
    window.location.assign("/login");
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenMobileNav} aria-label="فتح القائمة">
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text-primary">{workspaceName ?? "راصد"}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {subscriptionState ? <SubscriptionStatusBadge state={subscriptionState} className="hidden sm:inline-flex" /> : null}

        <ThemeToggle />

        <Link href="/notifications" className="relative">
          <Button variant="ghost" size="icon" aria-label="الإشعارات">
            <Bell className="h-5 w-5" aria-hidden />
          </Button>
          {notificationsQuery.data && notificationsQuery.data.unreadCount > 0 ? (
            <Badge tone="danger" className="absolute -end-1 -top-1 min-w-4 justify-center px-1 py-0 text-[10px]">
              {notificationsQuery.data.unreadCount > 9 ? "٩+" : notificationsQuery.data.unreadCount}
            </Badge>
          ) : null}
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="focus-ring rounded-full" aria-label="حساب المستخدم">
              <Avatar className="h-8 w-8">
                <AvatarFallback>{initialsFromName(workspaceName ?? "م")}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <User className="h-4 w-4" aria-hidden />
                الحساب والإعدادات
              </Link>
            </DropdownMenuItem>
            {isPlatformStaff ? (
              <DropdownMenuItem asChild>
                <Link href="/platform-admin">
                  <Shield className="h-4 w-4" aria-hidden />
                  إدارة راصد
                </Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={handleSignOut}>
              <LogOut className="h-4 w-4" aria-hidden />
              تسجيل الخروج
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
