-- Billing Engine — Phase 6 (MONTHLY-only). Widen the `notifications.type` CHECK
-- for the billing lifecycle notification set, and add two additive partial
-- indexes that back the deterministic payment-request / custom-offer expiry
-- sweeps (worker) and the stale-pending / near-expiry attention queries.
--
-- ADDITIVE ONLY. Legacy types are retained so historical rows stay valid. No
-- billing-cycle schema change (MONTHLY-only is enforced in the application trust
-- boundary; the existing MONTHLY|ANNUAL CHECKs remain for historical read
-- compatibility — see contracts `CREATABLE_BILLING_CYCLES`).
--
-- APPLY on a disposable/staging DB before deploy. NOT auto-applied to Production.

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_type_check";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check"
  CHECK ("type" IN (
    'SUBSCRIPTION_EXPIRING', 'FOLLOWUP_DUE', 'MISSING_RECORDS',
    'TRIAL_ENDING', 'TRIAL_EXPIRED', 'SUBSCRIPTION_ENDING', 'SUBSCRIPTION_EXPIRED',
    'PAYMENT_REQUEST_CREATED', 'PAYMENT_REQUEST_EXPIRING', 'PAYMENT_REQUEST_EXPIRED',
    'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED',
    'CAPACITY_STUDENTS', 'CAPACITY_TEAM',
    'CUSTOM_OFFER_READY', 'CUSTOM_OFFER_EXPIRING', 'CUSTOM_OFFER_ACCEPTED_PAYMENT_PENDING', 'CUSTOM_OFFER_APPLIED',
    'CUSTOM_REQUEST_CREATED', 'NEW_PAYMENT_PROOF_PENDING'
  ));
--> statement-breakpoint
-- Backs the payment-request expiry sweep (PENDING past expires_at) and the
-- "stale pending payment" attention item. Partial: only PENDING rows are swept.
CREATE INDEX IF NOT EXISTS "payment_requests_status_expires_at_idx"
  ON "payment_requests" ("status", "expires_at")
  WHERE "status" = 'PENDING';
--> statement-breakpoint
-- Backs the custom-offer expiry sweep + the "offer near expiry" attention item.
CREATE INDEX IF NOT EXISTS "custom_plan_offers_status_valid_until_idx"
  ON "custom_plan_offers" ("status", "valid_until")
  WHERE "status" = 'PENDING_CUSTOMER';
--> statement-breakpoint
-- app_worker grants for the billing lifecycle scan (payment-request / custom-offer
-- expiry sweeps + expiring reminders). Mirrors 0038/0066: a broad worker-only
-- SELECT policy (cross-tenant discovery), plus a TIGHTLY-BOUNDED UPDATE policy
-- that can ONLY flip a still-pending row to EXPIRED — USING restricts WHICH rows
-- (pending only), WITH CHECK restricts the NEW value (EXPIRED only), and the
-- column grant restricts it to the `status` column. The worker can therefore
-- never touch commercial fields, never revive/confirm/reject, only expire.
CREATE POLICY "payment_requests_worker_scan" ON "payment_requests" FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
CREATE POLICY "payment_requests_worker_expire" ON "payment_requests" FOR UPDATE TO app_worker
  USING ("status" = 'PENDING') WITH CHECK ("status" = 'EXPIRED');
--> statement-breakpoint
GRANT SELECT ON public.payment_requests TO app_worker;
--> statement-breakpoint
GRANT UPDATE ("status") ON public.payment_requests TO app_worker;
--> statement-breakpoint
CREATE POLICY "custom_plan_offers_worker_scan" ON "custom_plan_offers" FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
CREATE POLICY "custom_plan_offers_worker_expire" ON "custom_plan_offers" FOR UPDATE TO app_worker
  USING ("status" = 'PENDING_CUSTOMER') WITH CHECK ("status" = 'EXPIRED');
--> statement-breakpoint
GRANT SELECT ON public.custom_plan_offers TO app_worker;
--> statement-breakpoint
GRANT UPDATE ("status") ON public.custom_plan_offers TO app_worker;
