import { forwardRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * Side sheet/drawer — RTL-aware: "end" is the drawer's natural resting side
 * for an RTL document (visually the LEFT edge in RTL, matching how a
 * right-to-left reader expects a contextual panel to slide in from the
 * side they read toward last), "start" is the opposite edge, and
 * "bottom" is the mobile-friendly variant used for compact action sheets.
 */
const sheetVariants = cva("fixed z-50 flex flex-col gap-4 border-border bg-surface p-6 shadow-lg transition-transform", {
  variants: {
    side: {
      end: "inset-y-0 end-0 h-full w-full max-w-md border-s data-[state=open]:animate-slide-in-from-end",
      start: "inset-y-0 start-0 h-full w-full max-w-md border-e data-[state=open]:animate-slide-in-from-start",
      bottom: "inset-x-0 bottom-0 max-h-[85vh] rounded-t-xl border-t",
    },
  },
  defaultVariants: { side: "end" },
});

export interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, VariantProps<typeof sheetVariants> {
  /**
   * Override the close (×) button's own color classes — the default
   * (`text-text-tertiary hover:text-text-primary`) assumes a light
   * `--surface`-family background. A caller rendering SheetContent on a
   * dark surface (e.g. MobileNav's `bg-shell`) MUST pass a matching
   * light-on-dark pair here — measured, not guessed: the default combo
   * against `--shell-surface` is a 3.30:1 contrast, below WCAG AA.
   */
  closeClassName?: string;
}

export const SheetContent = forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(({ className, side, children, closeClassName, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-fade-in" />
    <DialogPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), "overflow-y-auto", className)} {...props}>
      {children}
      <DialogPrimitive.Close className={cn("absolute end-4 top-4 rounded-sm text-text-tertiary transition-colors hover:text-text-primary focus-ring", closeClassName)}>
        <X className="h-4 w-4" aria-hidden />
        <span className="sr-only">إغلاق</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export const SheetTitle = forwardRef<React.ElementRef<typeof DialogPrimitive.Title>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-semibold text-text-primary", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = forwardRef<React.ElementRef<typeof DialogPrimitive.Description>, React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-text-secondary", className)} {...props} />
));
SheetDescription.displayName = "SheetDescription";
