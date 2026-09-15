"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";
import type { OnboardingStatusResponse } from "@academic-precision/contracts";
import { useWorkspace } from "../../lib/workspace-provider";
import { qk } from "../../lib/query-keys";
import { fetchOnboardingStatus } from "../../lib/api/onboarding";
import { ONBOARDING_STEP_META } from "../../lib/onboarding/step-config";

/**
 * Compact guided-setup card for the Dashboard. Replaces the old
 * full-page "ابدأ مع راصد" section. Renders ONLY for Owners while
 * setup is incomplete; once every step is done the card silently
 * disappears (the launcher then holds a one-time completion state
 * the Owner can dismiss forever).
 *
 * The click opens the same guided-setup panel via the launcher — this
 * card is the dashboard's "shortcut" to it. When JS-triggering another
 * component from here would fight React's data flow, we route to the
 * next step's page directly, which is what the launcher's own CTA does
 * anyway, so behaviour stays identical.
 */
export function GuidedSetupSummary() {
  const { workspaceId, isOwner } = useWorkspace();
  const ws = workspaceId ?? "";
  const query = useQuery({
    queryKey: ws ? qk.onboarding.status(ws) : ["onboarding", "none", "status"],
    queryFn: () => fetchOnboardingStatus(ws),
    enabled: !!ws && isOwner,
    staleTime: 60_000,
  });
  const data = query.data;
  if (!isOwner || !data) return null;
  if (data.allDone) return null;
  return <SummaryCard data={data} />;
}

function SummaryCard({ data }: { data: OnboardingStatusResponse }) {
  const nextMeta = data.nextStep ? ONBOARDING_STEP_META[data.nextStep] : null;
  const percent = Math.round((data.completed / data.total) * 100);
  return (
    <section
      aria-label="إعداد الحساب"
      className="flex flex-col gap-3 rounded-xl border border-brand/30 bg-brand-subtle/30 p-4 sm:flex-row sm:items-center sm:gap-6 sm:p-5"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand text-brand-foreground">
          {data.completed === data.total ? (
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          ) : (
            <Sparkles className="h-5 w-5" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">إعداد حسابك</p>
          <p className="text-xs text-text-secondary">
            <span className="font-english tabular-nums" dir="ltr">
              {data.completed} / {data.total}
            </span>{" "}
            مكتملة
            {nextMeta ? (
              <>
                {" — "}
                <span className="text-text-primary">التالي: {nextMeta.title}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="hidden flex-1 items-center gap-3 sm:flex">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="font-english text-xs font-medium tabular-nums text-text-tertiary" dir="ltr">
          {percent}%
        </span>
      </div>

      {nextMeta ? (
        <a
          href={nextMeta.href}
          className="focus-ring inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-brand px-4 text-sm font-semibold text-brand-foreground shadow-sm hover:brightness-[1.05] active:scale-[0.98] motion-reduce:transition-none"
        >
          <span>{nextMeta.cta}</span>
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </a>
      ) : null}
    </section>
  );
}
