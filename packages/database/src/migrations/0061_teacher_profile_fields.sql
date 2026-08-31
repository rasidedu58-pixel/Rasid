-- Teacher Onboarding & Profile Foundation.
--
-- Additive per-user profile fields + the missing self-UPDATE policy so a
-- teacher can edit their OWN profile from settings/onboarding.
--
--   * users.governorate / users.subject / users.subject_other — nullable text,
--     stable codes validated in the contracts (Egypt governorate + subject
--     enums; subject_other holds the free text when subject = 'OTHER'). No DB
--     CHECK: the code list evolves, and the API validates every write against
--     the enum before storing (backend is the authority, not the client).
--   * NEW policy users_self_update: 0052 deliberately added users_self_read /
--     users_self_insert but NO self-UPDATE (fail-closed until a proven need).
--     Teacher profile edit is that need. This adds the row-scoping policy (own
--     row) AND — defense in depth at the grant layer — REPLACES app_runtime's
--     dormant table-wide UPDATE (0006) with a COLUMN-LEVEL UPDATE on exactly the
--     profile columns. So even the self-update policy cannot let a user rewrite
--     status/id/email_display/created_at of their own row. The only app_runtime
--     UPDATE on users is `updateUserProfile`, which sets exactly these columns,
--     so this breaks no existing flow (provisioning uses INSERT, not UPDATE).
--
-- app_platform_admin reads the new columns via its existing table-level SELECT
-- (0048) for Customer 360 display and does not write them (no new grant).
--
-- Code that SELECTs users.governorate/subject is NOT backward-compatible with a
-- pre-0061 schema — APPLY THIS FIRST (migrate-first), then deploy. Additive.
-- NOT auto-applied to Production.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "governorate" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subject" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subject_other" text;
--> statement-breakpoint
-- Tighten app_runtime's dormant table-wide UPDATE (0006) to column-level: a
-- teacher may only edit their own profile fields, never status/id/email/created_at.
REVOKE UPDATE ON public.users FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE ("full_name", "phone", "governorate", "subject", "subject_other", "updated_at")
  ON public.users TO app_runtime;
--> statement-breakpoint
DROP POLICY IF EXISTS "users_self_update" ON "users";
--> statement-breakpoint
CREATE POLICY "users_self_update" ON "users"
  FOR UPDATE
  TO app_runtime
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
