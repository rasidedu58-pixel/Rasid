import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,box-shadow,transform] duration-150 focus-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-foreground shadow-sm hover:bg-brand/90 hover:shadow-md active:bg-brand/95",
        secondary: "bg-surface-sunken text-text-primary border border-border hover:bg-surface-sunken/70 active:bg-surface-sunken",
        outline: "border border-border-strong bg-surface text-text-primary hover:bg-surface-sunken active:bg-surface-sunken/80",
        ghost: "text-text-primary hover:bg-surface-sunken active:bg-surface-sunken/80",
        danger: "bg-danger text-white shadow-sm hover:bg-danger/90 hover:shadow-md active:bg-danger/95",
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9 shrink-0 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    // Deployment Closure Delta — real production crash found via live QA:
    // Radix's `Slot` (what `asChild` renders as) requires EXACTLY one
    // element child; rendering `{loading ? <Loader2/> : null}` alongside
    // `{children}` always gave Slot an array of two items (even with the
    // spinner branch resolving to `null`), which threw "Slot failed to
    // slot onto its children" the moment any `asChild` button (e.g. a
    // Link styled as a button) rendered — reproduced live after login,
    // caught by `global-error.tsx`, root-caused via the browser console.
    // `asChild` composes onto another element (a Link, typically) and has
    // no loading state of its own in this product, so it renders ONLY the
    // single child Slot requires; the spinner stays exclusive to the real
    // `<button>` case.
    if (asChild) {
      return (
        <Slot className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button className={cn(buttonVariants({ variant, size }), className)} ref={ref} disabled={disabled || loading} {...props}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
