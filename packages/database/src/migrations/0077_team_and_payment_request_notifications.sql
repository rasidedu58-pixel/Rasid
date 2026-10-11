-- Mini phase — two notifications the product already had the vocabulary for but
-- never actually emitted: "a member accepted your invitation" and "a new payment
-- request needs review".
--
-- ADDITIVE ONLY. Three things, nothing else:
--
--  1. One new `notifications.type` value, `TEAM_INVITE_ACCEPTED`. Every existing
--     value is retained verbatim, so historical rows stay valid.
--
--  2. `app_worker` may READ `platform_admins`. The payment-proof notification is
--     addressed to platform staff, and the worker (which is what turns the
--     `PaymentRequestCreated` outbox event into notifications) must be able to
--     resolve WHO the active staff members are. SELECT only — the worker can
--     never grant, revoke, disable or create a staff row.
--
--  3. `app_platform_admin` may READ (and mark read) notifications — but ONLY the
--     platform-facing types. Without this the staff-facing notification would be
--     a row nobody can see: `notifications_owner_access` demands a matching
--     tenant workspace+user context, which platform staff never have. The type
--     predicate is the whole point: staff still cannot read a single customer's
--     own notifications.
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
    'CUSTOM_REQUEST_CREATED', 'NEW_PAYMENT_PROOF_PENDING',
    'TEAM_INVITE_ACCEPTED'
  ));
--> statement-breakpoint
-- 2. Worker reads the staff allowlist (recipients of NEW_PAYMENT_PROOF_PENDING).
DROP POLICY IF EXISTS "platform_admins_worker_read" ON "platform_admins";
--> statement-breakpoint
CREATE POLICY "platform_admins_worker_read" ON "platform_admins" FOR SELECT TO app_worker USING (true);
--> statement-breakpoint
GRANT SELECT ON public.platform_admins TO app_worker;
--> statement-breakpoint
-- 3. Platform staff read their OWN platform-facing notifications only. The
--    `type` predicate appears in both USING clauses, and the UPDATE grant is
--    column-restricted to `read_at`, so staff can mark one read and nothing else.
DROP POLICY IF EXISTS "notifications_platform_admin_select" ON "notifications";
--> statement-breakpoint
CREATE POLICY "notifications_platform_admin_select" ON "notifications" FOR SELECT TO app_platform_admin
  USING ("type" IN ('CUSTOM_REQUEST_CREATED', 'NEW_PAYMENT_PROOF_PENDING'));
--> statement-breakpoint
DROP POLICY IF EXISTS "notifications_platform_admin_mark_read" ON "notifications";
--> statement-breakpoint
CREATE POLICY "notifications_platform_admin_mark_read" ON "notifications" FOR UPDATE TO app_platform_admin
  USING ("type" IN ('CUSTOM_REQUEST_CREATED', 'NEW_PAYMENT_PROOF_PENDING'))
  WITH CHECK ("type" IN ('CUSTOM_REQUEST_CREATED', 'NEW_PAYMENT_PROOF_PENDING'));
--> statement-breakpoint
GRANT SELECT ON public.notifications TO app_platform_admin;
--> statement-breakpoint
GRANT UPDATE ("read_at") ON public.notifications TO app_platform_admin;
