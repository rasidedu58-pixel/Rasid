import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, invalid, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus-ring disabled:cursor-not-allowed disabled:opacity-50",
        invalid && "border-danger focus-visible:ring-danger",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";
