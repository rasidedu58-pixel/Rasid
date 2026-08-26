-- 0049 — Phase 15 scale-readiness: hot-path indexes the index audit proved
-- MISSING against the actual query shapes in code (each entry names the
-- exact query it serves — no speculative indexes).
--
-- All plain CREATE INDEX (not CONCURRENTLY): applied via the migration
-- runner inside its own transaction, and every table here is small enough
-- today (thousands of rows) that the build lock is momentary. Revisit
-- CONCURRENTLY only if a future index must be added to a huge live table.

-- 1. Students directory page: WHERE workspace_id = $1 [AND id > $cursor]
--    ORDER BY id LIMIT n  (students.repository.ts `searchStudents`, the
--    no-query branch — the single most-hit list in the product). The only
--    existing index was (workspace_id, status), which serves neither the
--    cursor nor the sort.
CREATE INDEX IF NOT EXISTS "students_workspace_id_id_idx"
  ON "students" ("workspace_id", "id");
--> statement-breakpoint

-- 2. Attention cases list: WHERE workspace_id = $1 [AND status = $2]
--    ORDER BY id  (attention.repository.ts `listAttentionCasesForWorkspace`
--    — cursor-paginated by id; the existing (workspace_id, status,
--    priority) index cannot provide the id ordering, and `priority` is
--    never filtered or sorted anywhere in the repository layer).
CREATE INDEX IF NOT EXISTS "attention_cases_workspace_status_id_idx"
  ON "attention_cases" ("workspace_id", "status", "id");
--> statement-breakpoint

-- 3. Worker global scan: sessions WHERE status = 'IN_PROGRESS' (no
--    workspace context — app_worker's RLS is USING(true), so the
--    workspace-leading composite is unusable and this was a full-table
--    scan on every notifications tick; sessions is the fastest-growing
--    table in the system). Partial: only the one status the scan reads.
CREATE INDEX IF NOT EXISTS "sessions_in_progress_scan_idx"
  ON "sessions" ("scheduled_at")
  WHERE "status" = 'IN_PROGRESS';
--> statement-breakpoint

-- 4. Worker global scan: scheduled_followups WHERE status = 'PENDING'
--    AND due_at <= now()  (same USING(true) problem as #3).
CREATE INDEX IF NOT EXISTS "scheduled_followups_pending_due_scan_idx"
  ON "scheduled_followups" ("due_at")
  WHERE "status" = 'PENDING';
--> statement-breakpoint

-- 5. Worker notification dedup pre-check: notifications WHERE workspace_id
--    AND type AND entity_type AND entity_id (notifications-scan.ts) — the
--    table had NO workspace-leading index at all; the dedup UNIQUE's
--    second column (user_id) is not in this predicate.
CREATE INDEX IF NOT EXISTS "notifications_workspace_entity_type_idx"
  ON "notifications" ("workspace_id", "entity_type", "entity_id", "type");
