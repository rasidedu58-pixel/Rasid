"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Sparkles, ArrowLeft } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchActionCenter } from "../../../lib/api/reports";
import { fetchSessions, fetchGroups } from "../../../lib/api/scheduling";
import { fetchStudents } from "../../../lib/api/students";
import { ActionItemRow, type ActionItem } from "./action-item-row";
import { NextSessionCard } from "./next-session-card";
import { OnboardingPanel, type SetupStep } from "./onboarding-panel";
import { TodaySummary, type SummaryCell } from "./today-summary";

const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

/**
 * The Dashboard / الرئيسية — Rasid's Daily Command Center. It embodies the
 * product's rhythm (سجّل → افهم → تصرّف → تابع): every block answers "what do I
 * do now?", never a wall of KPIs. All aggregation/urgency-scoring is done
 * server-side (`GET /action-center`); this page only renders real data:
 *   - Daily context (greeting/date + a qualitative, always-true summary)
 *   - Onboarding next-best-action (only while setup is incomplete)
 *   - Next session (name + time; live countdown computed client-side)
 *   - Needs-attention decision queue (the action-center buckets)
 *   - A compact "today" strip (only metrics that have a real source)
 * Widgets with no backing data (attendance %, collected-today, group health)
 * are deliberately NOT shown.
 */
export default function DashboardPage() {
  const { workspaceId, isOwner, hasPermission } = useWorkspace();
  const ws = workspaceId ?? "";
  const reduce = useReducedMotion();

  const canGroups = hasPermission("groups.view");
  const canStudents = hasPermission("students.view_basic");

  const today = useMemo(() => {
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    const e = new Date();
    e.setHours(23, 59, 59, 999);
    return { from: s.toISOString(), to: e.toISOString() };
  }, []);

  const acQuery = useQuery({
    queryKey: workspaceId ? qk.actionCenter.root(ws) : ["action-center", "none"],
    queryFn: () => fetchActionCenter(ws),
    enabled: !!workspaceId,
    refetchInterval: 120_000,
  });

  // Today's sessions — the ONLY real source for a "sessions today" figure.
  const todayQuery = useQuery({
    queryKey: qk.sessions.list(ws, { scope: "today", from: today.from, to: today.to }),
    queryFn: () => fetchSessions(ws, { from: today.from, to: today.to, limit: 100 }),
    enabled: !!workspaceId && canGroups,
  });

  // Onboarding is owner-only and stops running once the workspace is set up
  // (a per-workspace localStorage flag avoids re-checking forever).
  const [setupDone, setSetupDone] = useState(false);
  useEffect(() => {
    if (!ws) return;
    try {
      setSetupDone(localStorage.getItem(`rasid_setup_done_${ws}`) === "1");
    } catch {
      /* storage disabled — treat as not-done, checks below still run */
    }
  }, [ws]);
  const onboardingActive = isOwner && !setupDone;

  const groupsQuery = useQuery({
    queryKey: qk.groups.list(ws),
    queryFn: () => fetchGroups(ws),
    enabled: !!workspaceId && onboardingActive && canGroups,
  });
  const studentsQuery = useQuery({
    queryKey: qk.students.list(ws, { limit: 1 }),
    queryFn: () => fetchStudents(ws, { limit: 1 }),
    enabled: !!workspaceId && onboardingActive && canStudents,
  });

  const data = acQuery.data;

  // ── Onboarding steps (real completion, derived from emptiness) ──
  const hasGroup = (groupsQuery.data?.groups.length ?? 0) > 0;
  const hasStudent = (studentsQuery.data?.items.length ?? 0) > 0;
  const hasSession = !!data?.nextSession || (todayQuery.data?.items.length ?? 0) > 0;
  const steps: SetupStep[] = [
    { key: "group", label: "أنشئ أول مجموعة", description: "مجموعتك الدائمة بجدولها ورسومها.", done: hasGroup, href: "/groups", cta: "إنشاء مجموعة" },
    { key: "students", label: "أضف طلابك", description: "أضف طلاب مجموعاتك أو استوردهم.", done: hasStudent, href: "/students", cta: "إضافة طلاب" },
    { key: "month", label: "جهّز شهرك التشغيلي", description: "حدّد رسوم الشهر وجدوله الأسبوعي.", done: !!data?.month, href: "/months/new", cta: "تجهيز الشهر" },
    { key: "session", label: "جهّز أول حصة", description: "تتولّد حصصك تلقائيًا من جدول المجموعة.", done: hasSession, href: "/sessions", cta: "عرض الحصص" },
  ];
  const allStepsDone = steps.every((s) => s.done);
  const onboardingSettled =
    !onboardingActive ||
    (!!acQuery.data &&
      (!canGroups || groupsQuery.isSuccess || groupsQuery.isError) &&
      (!canStudents || studentsQuery.isSuccess || studentsQuery.isError));
  const showOnboarding = onboardingActive && onboardingSettled && !allStepsDone;

  useEffect(() => {
    if (onboardingActive && onboardingSettled && allStepsDone && ws) {
      try {
        localStorage.setItem(`rasid_setup_done_${ws}`, "1");
      } catch {
        /* ignore */
      }
      setSetupDone(true);
    }
  }, [onboardingActive, onboardingSettled, allStepsDone, ws]);

  // ── Loading / error ──
  if (acQuery.isLoading) {
    return (
      <>
        <PageHeader title="الرئيسية" />
        <div className="flex flex-col gap-6">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </div>
      </>
    );
  }
  if (acQuery.isError || !data) {
    return (
      <>
        <PageHeader title="الرئيسية" />
        <ErrorState onRetry={() => acQuery.refetch()} />
      </>
    );
  }

  // ── Decision queue (the action-center buckets) ──
  const buckets: Array<{ items: ActionItem[] } | undefined> = [data.missingRecords, data.followUpsDue, data.attention, data.collection];
  const allItems = buckets.flatMap((b) => b?.items ?? []);
  const urgent = allItems.filter((i) => i.urgency === "HIGH");
  const followUpSoon = allItems.filter((i) => i.urgency === "MEDIUM");
  const contextual = allItems.filter((i) => i.urgency === "LOW");

  // ── Daily context (qualitative — always true, no risky number/noun agreement) ──
  const now = new Date();
  const greeting = now.getHours() < 12 ? "صباح الخير" : "مساء الخير";
  const dateLabel = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long" }).format(now);
  const summary =
    urgent.length > 0
      ? "هناك بنود عاجلة تحتاج قرارك الآن."
      : allItems.length > 0
        ? "لا شيء عاجل — بعض البنود بحاجة إلى مراجعة."
        : "يومك هادئ — لا توجد حالات تحتاج تدخلك.";

  // ── Today strip (real cells only) ──
  const cells: SummaryCell[] = [];
  if (canGroups && todayQuery.data) {
    const total = todayQuery.data.items.length;
    if (total > 0) {
      const completed = todayQuery.data.items.filter((s) => s.status === "COMPLETED").length;
      cells.push({ key: "sessions", label: "حصص اليوم", value: `${arNum(completed)}/${arNum(total)}`, sub: "مكتملة" });
    }
  }
  cells.push({ key: "urgent", label: "يحتاج إجراء الآن", value: arNum(urgent.length), tone: urgent.length > 0 ? "danger" : "default" });
  if (data.followUpsDue) cells.push({ key: "followups", label: "متابعات مستحقة", value: arNum(data.followUpsDue.count) });
  if (data.collection) cells.push({ key: "collection", label: "تحصيل متأخر", value: arNum(data.collection.count), tone: data.collection.count > 0 ? "warning" : "default" });

  const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
  const item: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } } };

  return (
    <>
      <PageHeader eyebrow={dateLabel} title={greeting} description={summary} />

      {data.subscriptionWarning ? (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-2.5">
          <p className="text-sm text-warning">{data.subscriptionWarning.message}</p>
          <Link href="/settings?tab=billing" className="shrink-0 text-sm font-medium text-warning underline">
            إدارة الاشتراك
          </Link>
        </div>
      ) : null}

      {/* Non-owner with no operating month yet — they can't set it up themselves. */}
      {!data.month && !isOwner ? (
        <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-secondary">
          بانتظار مالك المساحة لتجهيز أول شهر تشغيلي.
        </div>
      ) : null}

      <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col gap-6">
        {showOnboarding ? (
          <motion.div variants={item}>
            <OnboardingPanel
              steps={steps}
              optional={isOwner ? [{ key: "team", label: "أضف عضوًا لفريقك", description: "", done: false, href: "/team", cta: "إدارة الفريق" }] : undefined}
            />
          </motion.div>
        ) : null}

        <motion.div variants={item}>
          <NextSessionCard session={data.nextSession ?? null} />
        </motion.div>

        {/* Needs attention — the decision queue */}
        <motion.div variants={item}>
          {allItems.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-8 w-8 text-brand" aria-hidden />}
              title="لا يوجد ما يحتاج إجراء الآن"
              description="كل شيء تحت السيطرة. سنعرض هنا أي أمر يحتاج قرارك فور ظهوره."
            />
          ) : (
            <section aria-label="يحتاج إجراء" className="flex flex-col gap-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-text-primary">يحتاج إجراء</h2>
                <Link href="/attention" className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
                  عرض كل الحالات
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Link>
              </div>
              {urgent.length > 0 ? <ActionGroup title="يحتاج إجراء الآن" items={urgent} variant="urgent" /> : null}
              {followUpSoon.length > 0 ? <ActionGroup title="يحتاج متابعة قريبًا" items={followUpSoon} variant="normal" /> : null}
              {contextual.length > 0 ? <ActionGroup title="معلومات سياقية" items={contextual} variant="quiet" /> : null}
            </section>
          )}
        </motion.div>

        {cells.length > 0 ? (
          <motion.div variants={item}>
            <TodaySummary cells={cells} />
          </motion.div>
        ) : null}
      </motion.div>
    </>
  );
}

/**
 * One urgency group. The urgent group is visually heaviest (a danger dot + a
 * danger-tinted count) so the eye lands there first; follow-up and contextual
 * groups get progressively quieter.
 */
function ActionGroup({ title, items, variant }: { title: string; items: ActionItem[]; variant: "urgent" | "normal" | "quiet" }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        {variant === "urgent" ? <span className="h-2 w-2 rounded-full bg-danger" aria-hidden /> : null}
        <h3 className={variant === "urgent" ? "text-sm font-semibold text-text-primary" : "text-sm font-semibold text-text-secondary"}>{title}</h3>
        <span
          className={
            variant === "urgent"
              ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-subtle px-1.5 text-xs font-semibold text-danger"
              : "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-sunken px-1.5 text-xs font-medium text-text-tertiary"
          }
        >
          {arNum(items.length)}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <ActionItemRow key={`${item.entityType}-${item.entityId}`} item={item} />
        ))}
      </div>
    </section>
  );
}
