"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@academic-precision/ui";
import { useVisibleNavItems } from "./use-visible-nav-items";

/**
 * Phase 13 — the Teacher App's own deliberate "over-brand" moment: a deep
 * shell surface (see globals.css's `--shell-*` tokens) instead of the flat
 * white-on-white sidebar every other screen used, so the product reads as
 * one confident, structured shell rather than a stack of admin-template
 * pages. Every other surface in the product stays a restrained neutral —
 * this is the one place identity concentrates.
 */
export function Sidebar() {
  const pathname = usePathname();
  const items = useVisibleNavItems();

  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-shell md:flex">
      <div className="flex h-16 items-center px-6">
        <span className="text-xl font-bold tracking-tight text-white">راصد</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                // Not the shared `.focus-ring` utility — that one's
                // ring-offset color is `--background` (light), which would
                // paint a jarring light gap on this dark shell surface.
                // Same ring+offset visual language, dark-shell-appropriate
                // colors instead (measured: shell-text on shell-active
                // 6.69:1, on shell-surface 14.20:1 — see the Phase 13
                // accessibility-fix commit).
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-shell-text focus-visible:ring-offset-2 focus-visible:ring-offset-shell",
                active ? "bg-shell-active text-shell-active-text shadow-sm" : "text-shell-text-muted hover:bg-shell-hover hover:text-shell-text",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
