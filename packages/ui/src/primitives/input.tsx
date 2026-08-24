import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, invalid, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-danger focus-visible:ring-danger",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});
Input.displayName = "Input";
