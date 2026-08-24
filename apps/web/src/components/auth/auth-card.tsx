import type { ReactNode } from "react";

/** Shared visual shell for every public auth page — calm, centered, branded, no product chrome. */
export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-sunken px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl font-bold text-brand">راصد</span>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex flex-col gap-1 text-center">
            <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
            {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
          </div>
          {children}
        </div>
        {footer ? <div className="mt-5 text-center text-sm text-text-secondary">{footer}</div> : null}
      </div>
    </div>
  );
}
