"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@academic-precision/ui";
import { useVisibleNavItems } from "./use-visible-nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const items = useVisibleNavItems();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-e border-border bg-surface md:flex">
      <div className="flex h-14 items-center px-5">
        <span className="text-lg font-bold text-brand">راصد</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-3 py-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-subtle text-brand-subtle-foreground" : "text-text-secondary hover:bg-surface-sunken hover:text-text-primary",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
