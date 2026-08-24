import { forwardRef } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";

export const Tabs = TabsPrimitive.Root;

/**
 * Phase 13: `flex w-full` (was `inline-flex`, content-width) — every real
 * usage in this product is a page-level primary tab switcher (Session
 * Mode's Attendance/Homework/Exam/Review being the highest-stakes one:
 * "large clear actions... minimal taps" for one-hand phone use during a
 * live class), never a small inline toggle, so equal-width full-span
 * triggers are a strict readability/tap-target improvement everywhere
 * this is used, not a Session-Mode-only special case.
 */
export const TabsList = forwardRef<React.ElementRef<typeof TabsPrimitive.List>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn("flex h-11 w-full items-center gap-1 rounded-md bg-surface-sunken p-1 text-text-secondary", className)} {...props} />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<React.ElementRef<typeof TabsPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-sm px-3 py-2 text-sm font-medium transition-all focus-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-text-primary data-[state=active]:shadow-sm",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<React.ElementRef<typeof TabsPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("mt-4 focus-ring", className)} {...props} />
));
TabsContent.displayName = "TabsContent";
