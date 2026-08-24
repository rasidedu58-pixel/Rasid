/** Maps an Action Center item's entityType to where its CTA should navigate — kept in one place so link targets never drift out of sync with the backend's own entityType strings. */
export function actionItemHref(entityType: string, entityId: string): string {
  switch (entityType) {
    case "attention_case":
      return `/attention/${entityId}`;
    case "session":
      return `/sessions/${entityId}`;
    case "scheduled_followup":
      return "/attention?tab=followups";
    case "financial_obligation":
      return "/finance";
    default:
      return "/dashboard";
  }
}
