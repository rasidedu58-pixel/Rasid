-- Phase 3 — Database Schema §11.3 (idempotency_records) exactly as
-- approved. Pulled forward for CreateMonth's Idempotency-Key contract
-- (API Contract §7) — see packages/database/src/schema/idempotency.ts.
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"response_code" integer,
	"response_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_status_check" CHECK ("idempotency_records"."status" IN ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE')),
	CONSTRAINT "idempotency_records_workspace_operation_key_unique" UNIQUE("workspace_id","operation","key")
);
