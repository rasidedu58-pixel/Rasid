export type AttentionTab = "cases" | "followups";

/**
 * Which tab the attention page should open on, given the `?tab=` deep-link
 * param. The dashboard's "متابعة مستحقة" item links to `/attention?tab=followups`
 * (see action-item-link.ts); before this the page always defaulted to "cases",
 * so the follow-up the teacher clicked never showed. Anything other than an
 * explicit `followups` falls back to the cases tab.
 */
export function initialAttentionTab(tabParam: string | null | undefined): AttentionTab {
  return tabParam === "followups" ? "followups" : "cases";
}
