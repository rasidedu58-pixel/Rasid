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
    // Billing notifications (PAYMENT_CONFIRMED / PAYMENT_REJECTED /
    // TRIAL_ENDING / SUBSCRIPTION_ENDING / PAYMENT_REQUEST_*) carry these two
    // entity types. They used to fall through to the dashboard, which is the
    // one place that tells the user nothing about the thing they clicked.
    case "payment_request":
    case "subscription":
      return "/settings?tab=billing";
    case "student":
      return `/students/${entityId}`;
    // TEAM_INVITE_ACCEPTED — the owner wants the team page, where the new
    // member (and their permissions) now is.
    case "workspace_membership":
      return "/team";
    default:
      return "/dashboard";
  }
}
