"use client";

import { Toaster as Sonner, toast } from "sonner";

/** Single toast host for the whole app — mounted once in the root layout. RTL-aware position (top-start visually becomes top-right in an RTL document). */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      dir="rtl"
      toastOptions={{
        classNames: {
          toast: "rounded-lg border border-border bg-surface text-text-primary shadow-md",
          title: "text-sm font-medium",
          description: "text-xs text-text-secondary",
          success: "!border-success/30",
          error: "!border-danger/30",
        },
      }}
    />
  );
}

export { toast };
