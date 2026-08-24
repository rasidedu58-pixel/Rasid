import { forwardRef } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../lib/cn";

export const Switch = forwardRef<React.ElementRef<typeof SwitchPrimitive.Root>, React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-surface-sunken transition-colors focus-ring data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-50", className)}
    {...props}
  >
    {/* ltr: unchecked near the right inner edge (translate-x-0.5), checked slides toward the left (translate-x-4). rtl: mirrored — checked slides toward the right side of the track instead. */}
    <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 translate-x-0.5 rounded-full bg-surface shadow-sm transition-transform data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
