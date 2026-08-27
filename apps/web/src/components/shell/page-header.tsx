import type { ReactNode } from "react";

/**
 * The one page-header grammar every main screen uses (§10). Start (right, in
 * RTL): an optional quiet eyebrow, the page title, an optional one-line
 * context. End (left): the primary action + any secondary controls. Titles
 * that already explain themselves take no filler subtitle.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <span className="text-xs font-medium text-text-tertiary">{eyebrow}</span> : null}
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-text-primary">{title}</h1>
        {description ? <p className="max-w-2xl text-sm leading-relaxed text-text-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 sm:pt-1">{actions}</div> : null}
    </div>
  );
}
