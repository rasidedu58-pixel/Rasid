-- Phase 10 — DB scale review finding: the outbox claim query
-- (`claimOneEvent` in worker/outbox-dispatcher.ts) filters
-- `status IN ('PENDING', 'FAILED', 'PROCESSING')` (PROCESSING is included
-- deliberately, so a crashed worker's row is eventually reclaimed once its
-- lease expires — see that file's own doc comment). The original partial
-- index (migration 0024) only covered `status IN ('PENDING', 'FAILED')` —
-- it never matched the REAL production claim query at all, which fell back
-- to a full Seq Scan on `outbox_events` every single poll cycle. Proven via
-- `EXPLAIN (ANALYZE, BUFFERS)` against an 8,000-row synthetic outbox_events
-- table during the Phase 10 DB scale review: Seq Scan, ~6ms at 8k rows —
-- harmless today, but Seq Scan cost is linear in table size, and this
-- query runs on every worker poll cycle (as often as every 250ms) against
-- a table Technical Architecture §14 itself already names as a
-- high-growth candidate. Widening the predicate to match the query exactly
-- is a straightforward, low-risk fix — same columns, same index, no new
-- table/logic.
--> statement-breakpoint
DROP INDEX "outbox_events_status_available_at_idx";
--> statement-breakpoint
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events" USING btree ("status","available_at") WHERE status IN ('PENDING', 'FAILED', 'PROCESSING');
