import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";

interface StateViewProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function StateView({ icon, title, description, action, className }: StateViewProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border px-6 py-8 text-center", className)}>
      {icon}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {description ? <p className="max-w-sm text-xs text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Empty state — must always point the user toward the right next action, never just say "no data". */
export function EmptyState({ title, description, action, icon, className }: StateViewProps) {
  return <StateView className={className} icon={icon ?? <Inbox className="h-8 w-8 text-text-tertiary" aria-hidden />} title={title} description={description} action={action} />;
}

/** A real request failure (network/5xx) — always offers Retry when one is provided. */
export function ErrorState({ title = "تعذّر تحميل البيانات", description = "حدث خطأ أثناء الاتصال بالخادم. حاول مرة أخرى.", onRetry, className }: { title?: string; description?: string; onRetry?: () => void; className?: string }) {
  return (
    <StateView
      className={className}
      icon={<AlertTriangle className="h-8 w-8 text-danger" aria-hidden />}
      title={title}
      description={description}
      action={onRetry ? <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw className="h-4 w-4" aria-hidden />إعادة المحاولة</Button> : undefined}
    />
  );
}

/** 403-shaped result — the caller's role/grants don't include this action. Distinct from ErrorState: nothing is broken, this is expected. */
export function PermissionDeniedState({ title = "لا تملك صلاحية الوصول لهذا القسم", description = "تواصل مع مالك المساحة إذا كنت بحاجة إلى هذه الصلاحية.", className }: { title?: string; description?: string; className?: string }) {
  return <StateView className={className} icon={<ShieldAlert className="h-8 w-8 text-text-tertiary" aria-hidden />} title={title} description={description} />;
}

/** Entitlement-blocked (expired/payment failed) — distinct copy from a permission block: this is about the workspace's subscription, not the user's role. */
export function EntitlementBlockedState({ title = "هذا الإجراء غير متاح حاليًا", description = "انتهى الاشتراك أو فشلت عملية الدفع. يمكنك مراجعة البيانات القديمة، لكن الإجراءات الجديدة معطّلة حتى تجديد الاشتراك.", action, className }: { title?: string; description?: string; action?: ReactNode; className?: string }) {
  return <StateView className={className} icon={<Lock className="h-8 w-8 text-warning" aria-hidden />} title={title} description={description} action={action} />;
}
