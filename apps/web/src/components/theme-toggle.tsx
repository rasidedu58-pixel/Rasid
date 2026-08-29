"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@academic-precision/ui";
import { useTheme } from "../lib/theme-provider";

/** Sun/moon theme switch. Icon reflects the action (shows the theme you'll switch TO). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const toLight = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={toLight ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"}
      title={toLight ? "الوضع الفاتح" : "الوضع الداكن"}
      className={cn(
        "focus-ring inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface hover:text-text-primary",
        className,
      )}
    >
      {toLight ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
    </button>
  );
}
