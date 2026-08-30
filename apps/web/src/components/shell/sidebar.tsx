"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@academic-precision/ui";
import { useWorkspace } from "../../lib/workspace-provider";
import { useVisibleNavItems } from "./use-visible-nav-items";
import { NAV_SECTION_LABEL, NAV_SECTION_ORDER, type NavItem, type NavSection } from "./nav-config";
import { BrandMark } from "../brand-mark";

/**
 * The Teacher App shell (Phase 13 → refined Phase UI-1). A deep, confident
 * shell surface (see `--shell-*` tokens) is the product's one deliberate
 * "over-brand" moment; every other surface stays a restrained neutral. UI-1
 * sharpens the identity: a real brand lockup + workspace context at the top,
 * quiet grouped navigation, an account group pinned to the footer, and a
 * calmer *selected* state — a subtle raised fill with a teal edge-accent and
 * teal icon, not a full saturated block.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { workspaceName } = useWorkspace();
  const items = useVisibleNavItems();

  const bySection = (section: NavSection) => items.filter((i) => i.section === section);
  const footerItems = bySection("account");
  const bodySections = NAV_SECTION_ORDER.filter((s) => s !== "account");

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-shell md:flex">
      {/* Brand + workspace context */}
      <div className="flex flex-col gap-3 px-4 pb-4 pt-5">
        <BrandMark tone="onDark" size="md" />
        {workspaceName ? (
          <div className="truncate rounded-md bg-shell-hover px-2.5 py-1.5 text-xs font-medium text-shell-text" title={workspaceName}>
            {workspaceName}
          </div>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-2">
        {bodySections.map((section) => {
          const sectionItems = bySection(section);
          if (sectionItems.length === 0) return null;
          const label = NAV_SECTION_LABEL[section];
          return (
            <div key={section} className="flex flex-col gap-0.5">
              {label ? (
                <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-shell-text-muted/80">{label}</p>
              ) : null}
              {sectionItems.map((item) => (
                <SidebarLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          );
        })}
      </nav>

      {footerItems.length > 0 ? (
        <div className="mt-auto flex flex-col gap-0.5 border-t border-shell-border px-3 py-3">
          {footerItems.map((item) => (
            <SidebarLink key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Same ring language as `.focus-ring` but with dark-shell-appropriate
        // offset color (measured contrasts documented in the Phase 13 fix).
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-shell-accent focus-visible:ring-offset-2 focus-visible:ring-offset-shell",
        active ? "bg-shell-active font-medium text-shell-text" : "font-normal text-shell-text-muted hover:bg-shell-hover/60 hover:text-shell-text",
      )}
    >
      {/* Selected marker: a bright teal edge-accent on the inner (content-facing) edge — end-0 is the left edge in this RTL shell. */}
      {active ? <span className="absolute end-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-shell-accent" aria-hidden /> : null}
      <Icon className={cn("h-[18px] w-[18px] shrink-0 transition-colors", active ? "text-shell-accent" : "text-shell-text-muted group-hover:text-shell-text")} aria-hidden />
      {item.label}
    </Link>
  );
}
