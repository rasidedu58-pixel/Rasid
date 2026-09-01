-- Billing Engine — Phase 3. Notifications for payment confirm/reject.
--
-- Additive. Beyond the two Payment-core tables (0063/0064), Phase 3's item 19
-- requires notifying the customer when their payment is confirmed/rejected.
-- Minimal: widen the `notifications.type` CHECK with two new types, and let the
-- trusted billing writer (app_platform_admin) INSERT a notification for the
-- customer owner inside the confirm/reject transaction (dedup via the existing
-- unique index + ON CONFLICT DO NOTHING). No new notification engine; the
-- "request created" case needs no notification (the owner sees status live).
--
-- APPLY on a disposable/staging DB before deploy. NOT auto-applied to Production.

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_type_check";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check"
  CHECK ("type" IN ('SUBSCRIPTION_EXPIRING', 'FOLLOWUP_DUE', 'MISSING_RECORDS', 'PAYMENT_CONFIRMED', 'PAYMENT_REJECTED'));
--> statement-breakpoint
-- app_platform_admin may INSERT a notification (recipient = the customer owner)
-- during confirm/reject. Read stays with the recipient's own tenant policy.
CREATE POLICY "notifications_platform_admin_insert" ON "notifications"
  FOR INSERT TO app_platform_admin WITH CHECK (true);
--> statement-breakpoint
GRANT INSERT ON public.notifications TO app_platform_admin;
