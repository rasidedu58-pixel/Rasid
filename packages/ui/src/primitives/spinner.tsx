import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-text-tertiary", className)} aria-hidden />;
}

/** Full-region loading state — centered spinner with a minimum height so the layout doesn't jump once content arrives. */
export function LoadingRegion({ label = "جارٍ التحميل...", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex min-h-40 flex-col items-center justify-center gap-2 text-text-tertiary", className)}>
      <Spinner />
      <p className="text-xs">{label}</p>
    </div>
  );
}
