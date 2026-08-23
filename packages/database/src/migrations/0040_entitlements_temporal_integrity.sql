-- Phase 8 Closure Delta #2 — Entitlement temporal integrity.
--
-- Restores the approved append+close model: on every recompute, the
-- previously-open row per (workspace_id, capability) is closed
-- (effective_to = transition_time) in the SAME transaction that inserts the
-- new open row (effective_from = transition_time, effective_to = NULL) —
-- see `subscriptions.repository.ts`'s `recomputeEntitlementSnapshot`. This
-- migration (a) backfills existing data so every (workspace_id, capability)
-- group has AT MOST ONE open row before the constraint below can be added,
-- (b) enforces "at most one open row per capability" at the DB level, and
-- (c) grants the two write roles ONLY the column-level UPDATE privilege
-- needed to close a row — never arbitrary mutation of historical state.
--
-- Backfill: every entitlements row inserted before this delta has
-- effective_to = NULL (the prior "latest effective_from wins" model never
-- closed anything). For each (workspace_id, capability) group, close every
-- row except the true latest one, using the NEXT row's own effective_from
-- as the close time — this reconstructs non-overlapping ranges exactly as
-- if append+close had been in effect from the start, with no invented
-- timestamps.
--> statement-breakpoint
WITH ordered AS (
  SELECT
    id,
    LEAD("effective_from") OVER (
      PARTITION BY "workspace_id", "capability"
      ORDER BY "effective_from" ASC
    ) AS next_effective_from
  FROM "entitlements"
)
UPDATE "entitlements" e
SET "effective_to" = o.next_effective_from
FROM ordered o
WHERE e."id" = o.id
  AND o.next_effective_from IS NOT NULL
  AND e."effective_to" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_workspace_capability_open_unique" ON "entitlements" USING btree ("workspace_id","capability") WHERE "entitlements"."effective_to" IS NULL;
--> statement-breakpoint
-- Column-level UPDATE: only the two fields a "close" ever touches. Neither
-- role can rewrite capability/state/source_type/effective_from/etc. on a
-- historical row — attempting to SET any other column fails with a
-- permission-denied error, the same structural guarantee `subscriptions`'
-- version-checked UPDATE already relies on for its own narrower blast
-- radius.
GRANT UPDATE ("effective_to", "updated_at") ON public.entitlements TO app_runtime;
--> statement-breakpoint
GRANT UPDATE ("effective_to", "updated_at") ON public.entitlements TO app_worker;
