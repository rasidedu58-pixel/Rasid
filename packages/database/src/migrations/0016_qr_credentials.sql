-- Phase 4 — qr_credentials. Database Schema §6.4. `token_hash` stores a
-- SHA-256 hex digest ONLY — the raw token is never persisted (Phase 4
-- prohibition: "Never: store a raw QR token anywhere").
--> statement-breakpoint
CREATE TABLE "qr_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"issued_by_user_id" uuid NOT NULL,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qr_credentials_status_check" CHECK ("qr_credentials"."status" IN ('ACTIVE', 'REVOKED'))
);
--> statement-breakpoint
ALTER TABLE "qr_credentials" ADD CONSTRAINT "qr_credentials_student_id_students_id_fk"
  FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qr_credentials" ADD CONSTRAINT "qr_credentials_issued_by_user_id_users_id_fk"
  FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "qr_credentials" ADD CONSTRAINT "qr_credentials_revoked_by_user_id_users_id_fk"
  FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- INT-04 — at most one ACTIVE QR credential per student.
CREATE UNIQUE INDEX "qr_credentials_student_active_unique" ON "qr_credentials" USING btree ("student_id") WHERE "qr_credentials"."status" = 'ACTIVE';
--> statement-breakpoint
-- Exact-hash lookup path for POST /qr/resolve — never fuzzy.
CREATE INDEX "qr_credentials_token_hash_idx" ON "qr_credentials" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "qr_credentials_workspace_student_idx" ON "qr_credentials" USING btree ("workspace_id","student_id");
