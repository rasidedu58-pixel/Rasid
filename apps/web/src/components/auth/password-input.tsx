"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input, cn, type InputProps } from "@academic-precision/ui";

/**
 * Password field with a reveal affordance (UI-6 §12). Wraps the shared
 * `Input` and adds a show/hide toggle pinned to the inner (end) edge — the
 * toggle only changes the input `type`, never the value, so all existing
 * validation and autoComplete behavior is preserved. `type` is owned here;
 * every other Input prop (id, value, onChange, autoComplete, minLength,
 * invalid, required…) passes straight through.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, "type">>(({ className, ...props }, ref) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} type={visible ? "text" : "password"} className={cn("pe-10", className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-md text-text-tertiary transition-colors hover:text-text-secondary focus-ring"
        aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        aria-pressed={visible}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";
