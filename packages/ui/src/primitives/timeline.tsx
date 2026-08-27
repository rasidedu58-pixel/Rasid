import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { SemanticTone } from "./badge";

/**
 * A thin chronological rail (Phase UI-2) for reading a record's history top
 * to bottom. A single hairline runs down the start (right, in RTL) edge;
 * each item hangs a small node off it with a compact date, title, secondary
 * context, and optional trailing action. Deliberately restrained — small
 * nodes, no oversized circles, no decorative rail noise.
 */
export function Timeline({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cn("relative flex flex-col", className)}>{children}</ol>;
}

const NODE_TONE: Record<SemanticTone, string> = {
  neutral: "bg-text-tertiary",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/**
 * One entry on the rail. `last` drops the connector below the final node so
 * the line ends cleanly. The node sits on the start edge; content flows
 * toward the end (content-facing) side.
 */
export function TimelineItem({
  date,
  title,
  context,
  tone = "neutral",
  action,
  last = false,
}: {
  date?: ReactNode;
  title: ReactNode;
  context?: ReactNode;
  tone?: SemanticTone;
  action?: ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* Rail + node on the start edge. */}
      <div className="relative flex w-3 shrink-0 justify-center">
        {!last ? <span className="absolute top-3 bottom-[-1.25rem] w-px bg-border" aria-hidden /> : null}
        <span className={cn("relative mt-1.5 h-2 w-2 rounded-full ring-4 ring-surface", NODE_TONE[tone])} aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {date ? <span className="text-xs text-text-tertiary">{date}</span> : null}
          <span className="text-sm font-medium text-text-primary">{title}</span>
          {context ? <span className="text-xs text-text-secondary">{context}</span> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </li>
  );
}
