-- Phase 3 — the deferred `permission_group_scopes.group_id` FK. Phase 2
-- deliberately omitted this constraint because `groups` did not exist yet
-- (see the Phase 2 migration/schema comments). Now that Phase 3 creates
-- `groups`, add the referential guarantee at the DB level. Hand-written:
-- this is a single, targeted ALTER on a pre-existing table/column, not a
-- new table drizzle-kit would otherwise need to diff.
--> statement-breakpoint
ALTER TABLE "permission_group_scopes" ADD CONSTRAINT "permission_group_scopes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;
