-- Phase 4 — closing the same class of gap documented in
-- 0014_group_months_cross_workspace_guard.sql (RLS only validates a row's
-- OWN workspace_id column, never a referenced row's tenant ownership; a
-- plain FK only proves the referenced row exists SOMEWHERE, not that it
-- belongs to the same workspace as the row referencing it). Closed
-- proactively here, rather than discovered live and patched afterward, for
-- the three Phase 4 referential cases called out in the phase brief:
-- student_guardians (student_id and guardian_id), qr_credentials
-- (student_id), and enrollments (student_id and group_month_id).
--
-- Same implementation shape as 0014: a BEFORE INSERT OR UPDATE trigger per
-- table, raising with ERRCODE 'foreign_key_violation' (Postgres CHECK
-- constraints cannot contain subqueries, so a trigger is required).
--> statement-breakpoint
CREATE OR REPLACE FUNCTION student_guardians_enforce_same_workspace()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM students s WHERE s.id = NEW.student_id AND s.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'student_guardians.student_id references a student belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM guardians g WHERE g.id = NEW.guardian_id AND g.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'student_guardians.guardian_id references a guardian belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER student_guardians_enforce_same_workspace_trigger
  BEFORE INSERT OR UPDATE OF student_id, guardian_id, workspace_id ON student_guardians
  FOR EACH ROW EXECUTE FUNCTION student_guardians_enforce_same_workspace();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION qr_credentials_enforce_same_workspace()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM students s WHERE s.id = NEW.student_id AND s.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'qr_credentials.student_id references a student belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER qr_credentials_enforce_same_workspace_trigger
  BEFORE INSERT OR UPDATE OF student_id, workspace_id ON qr_credentials
  FOR EACH ROW EXECUTE FUNCTION qr_credentials_enforce_same_workspace();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enrollments_enforce_same_workspace()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM students s WHERE s.id = NEW.student_id AND s.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'enrollments.student_id references a student belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM group_months gm WHERE gm.id = NEW.group_month_id AND gm.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'enrollments.group_month_id references a group_month belonging to a different workspace'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER enrollments_enforce_same_workspace_trigger
  BEFORE INSERT OR UPDATE OF student_id, group_month_id, workspace_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enrollments_enforce_same_workspace();
