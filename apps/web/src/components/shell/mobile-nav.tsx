"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle, cn } from "@academic-precision/ui";
import { useVisibleNavItems } from "./use-visible-nav-items";
import { RasidWordmark } from "../brand/rasid-wordmark";

export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname();
  const items = useVisibleNavItems();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="w-72 max-w-[85vw] border-shell-border bg-shell" closeClassName="text-shell-text-muted hover:text-shell-text">
        <SheetHeader>
          <SheetTitle>
            <RasidWordmark variant="default" tone="onDark" />
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-shell-text focus-visible:ring-offset-2 focus-visible:ring-offset-shell",
                  active ? "bg-shell-active text-shell-active-text" : "text-shell-text-muted hover:bg-shell-hover hover:text-shell-text",
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
