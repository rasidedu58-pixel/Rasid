import type { PermissionKey } from "@academic-precision/contracts";
import { LayoutDashboard, Users, Layers, CalendarClock, HeartHandshake, Wallet, FileBarChart, Bell, ShieldCheck, Settings } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Item is shown only if the caller holds at least one of these permissions — omitted means "always visible to any active member". */
  anyOf?: PermissionKey[];
  ownerOnly?: boolean;
}

/**
 * Single source of truth for the sidebar/mobile nav. Never render an item
 * the caller cannot act on (§8) — `Sidebar`/`MobileNav` both filter this
 * list through `useWorkspace().hasPermission`/`isOwner`.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "الرئيسية", icon: LayoutDashboard },
  { href: "/students", label: "الطلاب", icon: Users, anyOf: ["students.view_basic"] },
  { href: "/groups", label: "المجموعات", icon: Layers, anyOf: ["groups.view"] },
  { href: "/sessions", label: "الحصص", icon: CalendarClock, anyOf: ["groups.view"] },
  { href: "/attention", label: "المتابعة", icon: HeartHandshake, anyOf: ["followup.read"] },
  { href: "/finance", label: "المالية", icon: Wallet, anyOf: ["payments.view_student_status", "finance.overview"] },
  { href: "/reports", label: "التقارير", icon: FileBarChart, anyOf: ["reports.view"] },
  { href: "/notifications", label: "الإشعارات", icon: Bell },
  { href: "/team", label: "الفريق والصلاحيات", icon: ShieldCheck, ownerOnly: true },
  { href: "/settings", label: "الإعدادات", icon: Settings },
];
