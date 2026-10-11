/**
 * Where a PLATFORM-STAFF notification goes when clicked.
 *
 * Deliberately separate from the tenant-side `actionItemHref`: the same
 * `payment_request` entity means "your payment" to a customer (→ billing
 * settings) and "a request to review" to staff (→ the review queue). One
 * shared mapping would have to be wrong for one of them.
 *
 * Neither branch may fall back to a dashboard: a notification that lands on a
 * page saying nothing about what was clicked is the bug this replaces.
 */
export function platformNotificationHref(entityType: string | null): string {
  switch (entityType) {
    case "payment_request":
      // Defaults to the PENDING filter — the review queue itself.
      return "/platform-admin/payment-requests";
    case "custom_plan_request":
    case "custom_plan_offer":
      return "/platform-admin/custom-plans";
    default:
      return "/platform-admin/billing";
  }
}
