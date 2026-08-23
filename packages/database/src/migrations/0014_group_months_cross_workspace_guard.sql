-- Phase 3 fix: found during live RLS integration testing. RLS on
-- `group_months` only validates the row's OWN `workspace_id` column
-- against `app.workspace_id` — it says nothing about whether the
-- `group_id`/`operating_month_id` it references actually belong to that
-- same workspace. A plain FK only checks the referenced row EXISTS
-- somewhere, not which tenant it belongs to. Nothing at the DB level
-- previously stopped a `group_months` row from being inserted with a
-- correct (RLS-satisfying) `workspace_id` while pointing at a `groups` or
-- `operating_months` row that actually belongs to a DIFFERENT workspace.
--
-- Today's only real write path (SchedulingService.confirmCreateMonth /
-- runCreateMonthTransaction) always derives `operating_month_id` from the
-- OperatingMonth it just created in the same transaction using the same
-- workspaceId, and validates `group_id` ownership via
-- `loadGroupInScope`/`GroupOwnershipPort` before ever reaching the
-- repository — so this gap is not reachable through the current
-- application code. It is still a real, DB-level integrity gap worth
-- closing directly (defense-in-depth against any future/buggy code path
-- that bypasses the service layer), matching the mandatory test
-- "cross-workspace group scope FK/integrity" from the Phase 3 handoff.
--
-- Implemented as a trigger (Postgres CHECK constraints cannot contain
-- subqueries) rather than extending RLS, since RLS policies only see the
-- row being written, not arbitrary joins to validate referenced rows'
-- tenant ownership cheaply at every SELECT.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION group_months_enforce_same_workspace()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM groups g WHERE g.id = NEW.group_id AND g.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'group_months.group_id references a group belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM operating_months m WHERE m.id = NEW.operating_month_id AND m.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'group_months.operating_month_id references an operating_month belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER group_months_enforce_same_workspace_trigger
  BEFORE INSERT OR UPDATE OF group_id, operating_month_id, workspace_id ON group_months
  FOR EACH ROW EXECUTE FUNCTION group_months_enforce_same_workspace();
