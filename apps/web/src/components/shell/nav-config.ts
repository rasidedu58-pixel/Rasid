import type { PermissionKey } from "@academic-precision/contracts";
import { LayoutDashboard, Users, Layers, CalendarRange, CalendarClock, HeartHandshake, Wallet, FileBarChart, Bell, ShieldCheck, Settings } from "lucide-react";

/** Quiet grouping label shown above a run of nav items (§8 "navigation groups should be visually quiet"). */
export type NavSection = "home" | "operations" | "followup" | "account";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Which visual group this item belongs to in the sidebar. */
  section: NavSection;
  /** Item is shown only if the caller holds at least one of these permissions — omitted means "always visible to any active member". */
  anyOf?: PermissionKey[];
  ownerOnly?: boolean;
}

/** Human labels for the grouped sidebar. `home`/`account` render without a heading (home is the anchor; account is pinned to the footer). */
export const NAV_SECTION_LABEL: Record<NavSection, string | null> = {
  home: null,
  operations: "التشغيل",
  followup: "المتابعة والمالية",
  account: null,
};

/** Order the grouped sections render in, top to bottom. `account` is pinned to the sidebar footer by the Sidebar component. */
export const NAV_SECTION_ORDER: NavSection[] = ["home", "operations", "followup", "account"];

/**
 * Single source of truth for the sidebar/mobile nav. Never render an item
 * the caller cannot act on (§8) — `Sidebar`/`MobileNav` both filter this
 * list through `useWorkspace().hasPermission`/`isOwner`.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "الرئيسية", icon: LayoutDashboard, section: "home" },
  { href: "/students", label: "الطلاب", icon: Users, section: "operations", anyOf: ["students.view_basic"] },
  { href: "/groups", label: "المجموعات", icon: Layers, section: "operations", anyOf: ["groups.view"] },
  { href: "/months", label: "الأشهر التشغيلية", icon: CalendarRange, section: "operations", anyOf: ["groups.view"] },
  { href: "/sessions", label: "الحصص", icon: CalendarClock, section: "operations", anyOf: ["groups.view"] },
  { href: "/attention", label: "المتابعة", icon: HeartHandshake, section: "followup", anyOf: ["followup.read"] },
  { href: "/finance", label: "المالية", icon: Wallet, section: "followup", anyOf: ["payments.view_student_status", "finance.overview"] },
  { href: "/reports", label: "التقارير", icon: FileBarChart, section: "followup", anyOf: ["reports.view"] },
  { href: "/notifications", label: "الإشعارات", icon: Bell, section: "followup" },
  { href: "/team", label: "الفريق والصلاحيات", icon: ShieldCheck, section: "account", ownerOnly: true },
  { href: "/settings", label: "الإعدادات", icon: Settings, section: "account" },
];
