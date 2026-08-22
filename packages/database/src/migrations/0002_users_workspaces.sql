CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email_display" text,
	"phone" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_check" CHECK ("users"."status" IN ('ACTIVE', 'DISABLED'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"workspace_type" text DEFAULT 'TEACHER' NOT NULL,
	"locale" text DEFAULT 'ar-EG' NOT NULL,
	"timezone" text DEFAULT 'Africa/Cairo' NOT NULL,
	"due_date_policy" text DEFAULT 'PER_GROUP' NOT NULL,
	"unified_due_day" smallint,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "workspaces_type_check" CHECK ("workspaces"."workspace_type" IN ('TEACHER', 'CENTER')),
	CONSTRAINT "workspaces_status_check" CHECK ("workspaces"."status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "workspaces_due_date_policy_check" CHECK (("workspaces"."due_date_policy" = 'UNIFIED' AND "workspaces"."unified_due_day" BETWEEN 1 AND 28)
        OR ("workspaces"."due_date_policy" = 'PER_GROUP' AND "workspaces"."unified_due_day" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;