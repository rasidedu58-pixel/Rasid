import type { ActionItem } from "./action-item-row";

/**
 * Typed decision-queue sections for the dashboard. Pure + framework-free so
 * the grouping/ordering/cap rules can be unit-tested without a DOM.
 *
 * The queue is grouped BY TYPE (not by a flat urgency mix): the teacher
 * scans "what kind of thing needs me" at a glance. Section 1 folds
 * missed-sessions + missing-records together (both are "a session needs
 * recording work" and both route to a session), the rest map one-to-one to
 * their server buckets. Empty sections are dropped; each surviving section
 * is capped in the UI and links to its own filtered surface.
 */
export interface ActionSection {
  key: string;
  title: string;
  items: ActionItem[];
  /** The filtered surface this section's "عرض الكل (N)" opens. */
  viewAllHref: string;
}

/** The action-center buckets this builder consumes (each optional, each `{ items }`). */
export interface ActionCenterBuckets {
  missedSessions?: { items: ActionItem[] } | undefined;
  missingRecords?: { items: ActionItem[] } | undefined;
  attention?: { items: ActionItem[] } | undefined;
  followUpsDue?: { items: ActionItem[] } | undefined;
  collection?: { items: ActionItem[] } | undefined;
}

const URGENCY_RANK: Record<ActionItem["urgency"], number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Stable sort by urgency (HIGH first); preserves the server's own per-bucket order as the tie-break. */
export function sortByUrgency(items: ActionItem[]): ActionItem[] {
  return items
    .map((it, idx) => ({ it, idx }))
    .sort((a, b) => URGENCY_RANK[a.it.urgency] - URGENCY_RANK[b.it.urgency] || a.idx - b.idx)
    .map((x) => x.it);
}

/** Max items shown per section before collapsing behind a "عرض الكل (N)" link. */
export const SECTION_ITEM_CAP = 3;

/**
 * Build the ordered, non-empty typed sections from the action-center
 * buckets. Order is fixed (most-operational first): sessions → students →
 * due follow-ups → finance. Every section is urgency-sorted; empty ones
 * are removed.
 */
export function buildActionSections(data: ActionCenterBuckets): ActionSection[] {
  const sessionItems = [...(data.missedSessions?.items ?? []), ...(data.missingRecords?.items ?? [])];
  const sections: ActionSection[] = [
    { key: "sessions", title: "حصص تحتاج تسجيلًا", items: sortByUrgency(sessionItems), viewAllHref: "/sessions" },
    { key: "attention", title: "طلاب يحتاجون متابعة", items: sortByUrgency(data.attention?.items ?? []), viewAllHref: "/attention" },
    { key: "followups", title: "متابعات مستحقة", items: sortByUrgency(data.followUpsDue?.items ?? []), viewAllHref: "/attention?tab=followups" },
    { key: "collection", title: "تحصيل يحتاج متابعة", items: sortByUrgency(data.collection?.items ?? []), viewAllHref: "/finance" },
  ];
  return sections.filter((s) => s.items.length > 0);
}
