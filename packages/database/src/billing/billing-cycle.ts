/**
 * Billing-cycle trust boundary — V1 commercial policy: MONTHLY ONLY.
 *
 * The catalog still lists `ANNUAL` for historical read/parse compatibility (a
 * few legacy/test rows carry it), but no trusted creation flow may accept it.
 * Every create/renew/upgrade/custom path passes the client-or-admin-chosen
 * cycle through `assertMonthlyBillingCycle`, which throws a typed
 * `ANNUAL_BILLING_NOT_SUPPORTED` (mapped to a 422 by the API's billing-domain
 * filter via the `isBillingDomainError` marker) — never a silent conversion to
 * MONTHLY. Kept in one module so both the standard and custom repositories share
 * a single error class (no duplicate export, no cross-repository import cycle).
 */
export class AnnualBillingNotSupportedError extends Error {
  readonly isBillingDomainError = true as const;
  readonly code = "ANNUAL_BILLING_NOT_SUPPORTED";
  readonly httpStatus = 422;
  constructor() {
    super("الاشتراك السنوي غير مدعوم — جميع الباقات شهرية فقط.");
    this.name = "AnnualBillingNotSupportedError";
  }
}

/** Reject any non-monthly billing cycle at a creation boundary with a typed 4xx. No silent conversion. */
export function assertMonthlyBillingCycle(cycle: string): void {
  if (cycle !== "MONTHLY") throw new AnnualBillingNotSupportedError();
}
