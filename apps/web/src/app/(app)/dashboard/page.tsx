"use client";

// Phase 15C dashboard: TodaySummary hoisted to the top of the shell,
// action-item rows carry a real reason subtitle, and both `متابعات
// مستحقة` / `تحصيل متأخر` cells deep-link to their filtered surfaces.
// See the accompanying commit's message for the full track.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Sparkles, ArrowLeft } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchActionCenter } from "../../../lib/api/reports";
import { fetchSessions } from "../../../lib/api/scheduling";
import { ActionItemRow } from "./action-item-row";
import { buildActionSections, SECTION_ITEM_CAP, type ActionSection } from "./action-sections";
import { NextSessionCard } from "./next-session-card";
import { GuidedSetupSummary } from "../../../components/onboarding/guided-setup-summary";
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

  const data = acQuery.data;

  // Guided setup lives in the persistent shell launcher; here we show
  // only a compact summary card whose visibility is derived server-side
  // (Owner-only, hidden when every step is COMPLETED).

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

  // ── Decision queue — TYPED sections, most-operational first ──
  //
  // The queue is grouped BY TYPE (not by a flat urgency mix), so the
  // teacher scans "what kind of thing needs me" at a glance instead of a
  // long homogeneous list. Each section is capped at 3 items with a
  // "عرض الكل (N)" link to its own filtered surface, and an empty section
  // is hidden entirely (never a wall of empty states). Within a section,
  // items are ordered by urgency (HIGH → MEDIUM → LOW); the server already
  // returns each bucket in its own recency/priority order, which the
  // stable sort preserves as the tie-break.
  //
  // Typed sections (pure builder — see `action-sections.ts`), most-
  // operational first, empty ones dropped, urgency-sorted within each.
  const sections = buildActionSections(data);
  const allItems = sections.flatMap((s) => s.items);
  const urgent = allItems.filter((i) => i.urgency === "HIGH");

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
  //
  // Each cell only carries an `href` when there is a REAL filtered
  // destination that would surface exactly this metric's items. Owner
  // directive (dashboard reorder): «لا تضف روابط بفلاتر غير مدعومة».
  //   - `sessions` / `urgent` — no dedicated filtered page exists; the
  //     items themselves are already in the queue below on this same
  //     dashboard, so a link would just point back into the current
  //     screen. Left as a plain non-interactive tile.
  //   - `followups` → the follow-ups tab (same route the individual
  //     action-item rows use).
  //   - `collection` → the finance page (same route as its action items).
  const cells: SummaryCell[] = [];
  if (canGroups && todayQuery.data) {
    const total = todayQuery.data.items.length;
    if (total > 0) {
      const completed = todayQuery.data.items.filter((s) => s.status === "COMPLETED").length;
      cells.push({ key: "sessions", label: "حصص اليوم", value: `${arNum(completed)}/${arNum(total)}`, sub: "مكتملة" });
    }
  }
  cells.push({ key: "urgent", label: "يحتاج إجراء الآن", value: arNum(urgent.length), tone: urgent.length > 0 ? "danger" : "default" });
  if (data.followUpsDue) cells.push({ key: "followups", label: "متابعات مستحقة", value: arNum(data.followUpsDue.count), href: "/attention?tab=followups" });
  if (data.collection) cells.push({ key: "collection", label: "تحصيل متأخر", value: arNum(data.collection.count), tone: data.collection.count > 0 ? "warning" : "default", href: "/finance" });

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
        {/*
          Owner directive (Phase 15C dashboard reorder): «ملخص اليوم» must
          be one of the first things the teacher sees, not buried after
          the decision queue. Placed here — directly after the greeting +
          subscription banner — before Guided Setup / Next Session / the
          queue itself.
        */}
        {cells.length > 0 ? (
          <motion.div variants={item}>
            <TodaySummary cells={cells} />
          </motion.div>
        ) : null}

        <motion.div variants={item}>
          <GuidedSetupSummary />
        </motion.div>

        <motion.div variants={item}>
          <NextSessionCard session={data.nextSession ?? null} />
        </motion.div>

        {/* Needs attention — the typed decision queue */}
        <motion.div variants={item}>
          {sections.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-8 w-8 text-brand" aria-hidden />}
              title="لا يوجد ما يحتاج إجراء الآن"
              description="كل شيء تحت السيطرة. سنعرض هنا أي أمر يحتاج قرارك فور ظهوره."
            />
          ) : (
            <section aria-label="يحتاج إجراء" className="flex flex-col gap-6">
              <h2 className="text-base font-semibold text-text-primary">يحتاج إجراء</h2>
              {sections.map((s) => (
                <ActionSectionBlock key={s.key} section={s} />
              ))}
            </section>
          )}
        </motion.div>
      </motion.div>
    </>
  );
}

/**
 * One typed section: heading + count, up to {@link SECTION_ITEM_CAP} rows,
 * and a "عرض الكل (N)" link to its own filtered surface when there are more.
 * Never renders when empty (the parent filters those out first).
 */
function ActionSectionBlock({ section }: { section: ActionSection }) {
  const shown = section.items.slice(0, SECTION_ITEM_CAP);
  const total = section.items.length;
  const hasUrgent = section.items.some((i) => i.urgency === "HIGH");
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        {hasUrgent ? <span className="h-2 w-2 rounded-full bg-danger" aria-hidden /> : null}
        <h3 className="text-sm font-semibold text-text-primary">{section.title}</h3>
        <span
          className={
            hasUrgent
              ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-subtle px-1.5 text-xs font-semibold text-danger"
              : "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-sunken px-1.5 text-xs font-medium text-text-tertiary"
          }
        >
          {arNum(total)}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {shown.map((item) => (
          <ActionItemRow key={`${item.entityType}-${item.entityId}`} item={item} />
        ))}
      </div>
      {total > SECTION_ITEM_CAP ? (
        <Link
          href={section.viewAllHref}
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-brand hover:underline"
        >
          عرض الكل ({arNum(total)})
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
    </section>
  );
}
