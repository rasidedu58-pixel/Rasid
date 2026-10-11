-- Invitations: no deadline.
--
-- Product decision (Phase 4): an invitation stays valid until it is ACCEPTED
-- or the owner REVOKES it. The 7-day clock was never a security control — the
-- token is 32 random bytes stored only as a SHA-256 digest, single-use, and
-- revocable at any instant — it only produced dead links the owner had to
-- recreate, and a "منتهية" badge the teacher could do nothing useful with.
--
-- `expires_at` is made NULLABLE rather than dropped: NULL = no deadline, so a
-- future policy can reintroduce one per-invitation with no further schema
-- change, and the accept transaction's single-use race guard keeps its
-- original shape (`status = 'PENDING' AND (expires_at IS NULL OR expires_at > now())`).
--
-- Existing PENDING rows are cleared to NULL so links the owner already shared
-- stop dying on the old clock — that is the point of the change. ACCEPTED and
-- REVOKED rows are left exactly as they are: their `expires_at` is history,
-- and neither status can be accepted again regardless of it.
--
-- Additive + idempotent. Safe to apply before deploying the code that reads
-- it (the previous code never wrote NULL, and reads a NULL only after this).

ALTER TABLE "workspace_invitations" ALTER COLUMN "expires_at" DROP NOT NULL;
--> statement-breakpoint
UPDATE "workspace_invitations" SET "expires_at" = NULL WHERE "status" = 'PENDING' AND "expires_at" IS NOT NULL;
