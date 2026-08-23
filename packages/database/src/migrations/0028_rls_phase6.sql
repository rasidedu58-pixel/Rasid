-- Phase 6 — Row Level Security + least-privilege runtime grants for the 3
-- new tables (financial_obligations, payments, payment_reversals). Same
-- ADR-017 tenant-isolation pattern as every prior phase's finance-adjacent
-- migration (0012/0019/0022/0024's NULLIF-guarded pattern).
--
-- app_runtime NEVER gets DELETE — financial history is never hard-deleted
-- (PRD's own deletion-policy rule). `payments.status` DOES transition
-- POSTED→REVERSED via UPDATE (inside reversePaymentTransaction) — amount/
-- obligation_id/idempotency_key are never touched by that UPDATE; nothing
-- in the application layer writes to those columns after INSERT.
--> statement-breakpoint
ALTER TABLE "financial_obligations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_reversals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "financial_obligations_tenant_isolation" ON "financial_obligations"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "payments_tenant_isolation" ON "payments"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "payment_reversals_tenant_isolation" ON "payment_reversals"
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.financial_obligations TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.payments TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.payment_reversals TO app_runtime;
