"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, Lock, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@academic-precision/ui";
import type {
  OnboardingStatusResponse,
  OnboardingStepKey,
  OnboardingStepStatus,
} from "@academic-precision/contracts";
import { useWorkspace } from "../../lib/workspace-provider";
import { qk } from "../../lib/query-keys";
import { fetchOnboardingStatus } from "../../lib/api/onboarding";
import {
  ONBOARDING_STEP_META,
  ONBOARDING_STEP_META_ORDERED,
} from "../../lib/onboarding/step-config";

/**
 * Guided Setup Launcher — the persistent workspace-setup companion for
 * new Owners. Mounts once at the shell level so it stays available
 * across every app screen without being tied to a page.
 *
 * Product rules (owner-approved):
 *   • Owner-only. Non-owners never see the launcher at all — the
 *     dashboard already renders a passive "workspace is still being
 *     set up" notice for them, no duplicate scaffolding here.
 *   • Progress is 100% derived from real workspace state
 *     (`GET /onboarding/status`) — not from route visits, not from
 *     button clicks, and never from localStorage.
 *   • The one localStorage flag we keep is a purely presentational
 *     "dismissed after completion" bit, so a workspace that has
 *     finished setup can hide the launcher permanently (or bring it
 *     back by clearing that key manually — non-critical).
 *   • Panel opens as a bottom sheet on mobile and a side sheet on
 *     ≥sm — Radix handles the focus trap, Escape, and overlay, so
 *     accessibility comes for free.
 */
const DISMISSED_KEY_PREFIX = "rasid_guided_dismissed_";

export function GuidedSetupLauncher() {
  const { workspaceId, isOwner } = useWorkspace();
  const ws = workspaceId ?? "";
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Track viewport once mount is safe (matchMedia isn't SSR-friendly).
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Hydrate the presentational dismiss bit AFTER mount so SSR and CSR
  // agree on the first paint — the FAB is hidden the same way on both.
  useEffect(() => {
    if (!ws) return;
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY_PREFIX + ws) === "1");
    } catch {
      /* private mode / storage blocked — treat as not dismissed */
    }
  }, [ws]);

  const query = useQuery({
    queryKey: ws ? qk.onboarding.status(ws) : ["onboarding", "none", "status"],
    queryFn: () => fetchOnboardingStatus(ws),
    // Only owners need the launcher — never spend a request for a non-owner.
    enabled: !!ws && isOwner,
    // Progress refreshes cheaply, but we still don't want to poll for it —
    // mutation invalidations (months / enrollments / attendance) already
    // flip the key. A modest staleTime keeps repeated pane opens instant.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const data = query.data;

  const dismissPermanently = () => {
    if (!ws) return;
    try {
      localStorage.setItem(DISMISSED_KEY_PREFIX + ws, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
    setOpen(false);
  };

  // Show conditions:
  //   1. There must be an active workspace + the caller is Owner.
  //   2. Status has loaded (avoid a phantom FAB during network glitches).
  //   3. If everything is COMPLETED and the user asked to dismiss it, hide.
  if (!ws || !isOwner) return null;
  if (!data) return null;
  if (data.allDone && dismissed) return null;

  return (
    <>
      <LauncherButton
        completed={data.completed}
        total={data.total}
        allDone={data.allDone}
        onOpen={() => setOpen(true)}
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "start"}
          className={isMobile ? "" : "max-w-md"}
        >
          <PanelContent data={data} onDismissForever={dismissPermanently} />
        </SheetContent>
      </Sheet>
    </>
  );
}

/**
 * The floating trigger. Fixed at the visual bottom-LEFT of the viewport
 * (owner review: the right-hand side collided with the desktop sidebar's
 * footer icons for Team/Settings; the left edge is free of persistent
 * chrome in both light and dark themes). In RTL, the Tailwind logical
 * property `end-*` resolves to `left`, and we pair it with
 * `env(safe-area-inset-left)` so an iOS PWA never overlaps the physical
 * left safe-area. Sits above the mobile BottomNav (`bottom-24` on mobile
 * ≈ 96px, `bottom-6` on ≥sm). Circular; the number acts as its label
 * ("`n / total`") so the button is meaningful on its own without an
 * icon-only mystery.
 */
function LauncherButton({
  completed,
  total,
  allDone,
  onOpen,
}: {
  completed: number;
  total: number;
  allDone: boolean;
  onOpen: () => void;
}) {
  const percent = Math.round((completed / total) * 100);
  const ariaLabel = allDone
    ? "إعداد الحساب مكتمل — عرض الملخص"
    : `متابعة إعداد الحساب — ${completed} من ${total} مكتملة`;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="focus-ring fixed z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-lg ring-1 ring-black/10 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0 bottom-[max(calc(env(safe-area-inset-bottom)+5.5rem),5.5rem)] end-[max(1rem,env(safe-area-inset-left))] sm:bottom-[max(1.5rem,env(safe-area-inset-bottom))] sm:end-6"
    >
      {/* Circular progress ring — pure SVG so it obeys `prefers-reduced-motion`
          (no animation on it at all). */}
      <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={2.5} />
        <circle
          cx="18"
          cy="18"
          r="16"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${percent} ${100 - percent}`}
          pathLength={100}
        />
      </svg>
      {allDone ? (
        <Check className="relative h-5 w-5" aria-hidden />
      ) : (
        <span className="relative font-english text-sm font-semibold tabular-nums leading-none" dir="ltr">
          {completed}/{total}
        </span>
      )}
      <span className="sr-only">إعداد الحساب</span>
    </button>
  );
}

/** Panel body — header, overall progress, five step rows, dismissal footer. */
function PanelContent({
  data,
  onDismissForever,
}: {
  data: OnboardingStatusResponse;
  onDismissForever: () => void;
}) {
  const percent = Math.round((data.completed / data.total) * 100);
  return (
    <div className="flex flex-col gap-5" data-testid="guided-setup-panel">
      <div>
        <SheetTitle>إعداد حسابك</SheetTitle>
        <SheetDescription>
          {data.allDone
            ? "أصبحت جاهزًا للعمل على راصد."
            : `${data.completed} من ${data.total} مكتملة — اتبع الخطوات حسب الترتيب.`}
        </SheetDescription>
      </div>

      <ProgressBar percent={percent} />

      <ol className="flex flex-col gap-3">
        {ONBOARDING_STEP_META_ORDERED.map((meta) => (
          <StepRow key={meta.key} stepKey={meta.key} status={data.steps[meta.key]} />
        ))}
      </ol>

      {data.allDone ? (
        <FinishedFooter onDismissForever={onDismissForever} />
      ) : null}
    </div>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="flex items-center gap-3" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
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
  );
}

function StepRow({ stepKey, status }: { stepKey: OnboardingStepKey; status: OnboardingStepStatus }) {
  const meta = ONBOARDING_STEP_META[stepKey];
  const isCompleted = status === "COMPLETED";
  const isAvailable = status === "AVAILABLE";
  const description = useMemo(() => {
    if (isCompleted && meta.completedDescription) return meta.completedDescription;
    return meta.description;
  }, [isCompleted, meta.completedDescription, meta.description]);

  return (
    <li
      className={
        "flex items-start gap-3 rounded-xl border p-3 transition-colors " +
        (isAvailable
          ? "border-brand/30 bg-brand-subtle/30"
          : "border-border bg-surface")
      }
      data-status={status}
      data-step={stepKey}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {isCompleted ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success text-success-foreground">
            <Check className="h-4 w-4" />
          </span>
        ) : isAvailable ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-brand-foreground text-xs font-semibold">
            <ChevronLeft className="h-4 w-4" />
          </span>
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong bg-surface-sunken text-text-tertiary">
            <Lock className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={
            "text-sm font-semibold " +
            (isCompleted ? "text-text-secondary line-through decoration-text-tertiary/50" : "text-text-primary")
          }
        >
          {meta.title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">
          {status === "LOCKED" ? meta.depHint : description}
        </p>
        {isAvailable ? (
          <Link
            href={meta.href}
            className="focus-ring mt-2 inline-flex h-9 items-center justify-center rounded-md bg-brand px-4 text-xs font-semibold text-brand-foreground shadow-sm hover:brightness-[1.05] active:scale-[0.98] motion-reduce:transition-none"
          >
            {meta.cta}
          </Link>
        ) : null}
      </div>
      {/* Non-color completed indicator (accessibility: never rely on color alone). */}
      {isCompleted ? (
        <span className="sr-only">مكتملة</span>
      ) : status === "LOCKED" ? (
        <span className="sr-only">مقفلة — {meta.depHint}</span>
      ) : (
        <span className="sr-only">الخطوة الحالية</span>
      )}
    </li>
  );
}

function FinishedFooter({ onDismissForever }: { onDismissForever: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-brand/30 bg-brand-subtle/40 p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand" aria-hidden />
        <p className="text-sm font-semibold text-text-primary">أصبحت جاهزًا للعمل على راصد</p>
      </div>
      <p className="text-xs leading-relaxed text-text-secondary">
        تم إعداد الأساسيات، ويمكنك الآن إدارة عملك اليومي من الصفحة الرئيسية.
      </p>
      <button
        type="button"
        onClick={onDismissForever}
        className="focus-ring mt-1 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-sunken"
      >
        إخفاء دليل الإعداد نهائيًا
      </button>
    </div>
  );
}
