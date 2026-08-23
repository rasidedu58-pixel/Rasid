-- Phase 7 — dedicated least-privilege `app_worker` Postgres role, exactly
-- mirroring `app_runtime`'s own provisioning (0006_runtime_role_least_
-- privilege.sql): NOLOGIN by default (a one-time, out-of-band `ALTER ROLE
-- app_worker WITH LOGIN PASSWORD '<secret>'` enables it per environment,
-- password never committed), NOSUPERUSER NOCREATEDB NOCREATEROLE
-- NOBYPASSRLS NOREPLICATION.
--
-- WHY A SEPARATE ROLE (explicit product requirement, not an engineering
-- preference): `app_runtime` was deliberately granted only SELECT+INSERT
-- on `outbox_events` (0024_outbox_events.sql's own comment: "status
-- transitions belong to a future worker phase and its own role, not
-- granted here") — this was tested and enforced from Phase 5 onward.
-- Widening `app_runtime` to also UPDATE outbox_events, just to make a
-- worker easy to bolt on, would violate that already-proven boundary and
-- give every HTTP request-serving connection a capability it never needs
-- (marking arbitrary events PROCESSED/FAILED). `app_worker` gets its own
-- role instead, with the NARROWEST possible grant for its actual job:
-- claim + process outbox rows, and read/write ONLY the domain tables the
-- rule engine touches.
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION CONNECTION LIMIT 5;
  END IF;
END
$$;
--> statement-breakpoint
GRANT CONNECT ON DATABASE postgres TO app_worker;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_worker;
--> statement-breakpoint
-- Outbox: the worker CLAIMS pending events across every workspace (it does
-- not yet know which workspace an event belongs to until it reads the
-- row), so it needs SELECT across the whole table — the general
-- `outbox_events_tenant_isolation` policy (0024) does not carry a `TO`
-- clause, so it already applies to every non-bypass role including
-- `app_worker`, and would otherwise restrict it to whatever
-- `app.workspace_id` happens to be set to. A second PERMISSIVE policy,
-- scoped `TO app_worker` only, is added below — Postgres ORs permissive
-- policies together, so the net effect for `app_worker` specifically is
-- unrestricted SELECT (still workspace-isolated for every other role).
CREATE POLICY "outbox_events_worker_claim_access" ON "outbox_events"
  FOR SELECT
  TO app_worker
  USING (true);
--> statement-breakpoint
CREATE POLICY "outbox_events_worker_update_access" ON "outbox_events"
  FOR UPDATE
  TO app_worker
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON public.outbox_events TO app_worker;
--> statement-breakpoint
-- Column-level UPDATE grant — the worker may only ever flip an event's own
-- processing-lifecycle columns, never its identity/payload
-- (event_type/aggregate_type/aggregate_id/payload/workspace_id/
-- occurred_at/created_at are immutable once written).
GRANT UPDATE (status, available_at, attempt_count, processed_at, last_error) ON public.outbox_events TO app_worker;
--> statement-breakpoint
-- The rule engine itself also emits new outbox events
-- (AttentionCaseOpened/Updated) — INSERT, workspace-scoped like every
-- other writer (the general tenant_isolation WITH CHECK already covers
-- this once `app.workspace_id` is set for the event's own workspace).
GRANT INSERT ON public.outbox_events TO app_worker;
--> statement-breakpoint
-- Domain tables the rule engine reads to evaluate the 6 active rules —
-- read-only, workspace-scoped via the SAME general tenant_isolation
-- policies already in force for app_runtime (no `TO` clause on those
-- policies — see 0009/0018/0022's own RLS migrations — so they apply
-- identically to app_worker once it sets app.workspace_id per event,
-- exactly like `withRuntimeContext` already does for app_runtime).
GRANT SELECT ON public.session_records TO app_worker;
--> statement-breakpoint
GRANT SELECT ON public.sessions TO app_worker;
--> statement-breakpoint
GRANT SELECT ON public.session_exams TO app_worker;
--> statement-breakpoint
GRANT SELECT ON public.enrollments TO app_worker;
--> statement-breakpoint
GRANT SELECT ON public.group_months TO app_worker;
--> statement-breakpoint
-- Attention tables — the rule engine is the ONLY writer of
-- attention_reasons/attention_evidence, and the primary creator/escalator
-- of attention_cases (app_runtime only transitions status afterward — see
-- 0031's own comment for the split).
GRANT SELECT, INSERT, UPDATE ON public.attention_cases TO app_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.attention_reasons TO app_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.attention_evidence TO app_worker;
--> statement-breakpoint
-- Note: no further `anon`/`authenticated` revocation is needed here — the
-- default-privilege revocation is already global (0006's `ALTER DEFAULT
-- PRIVILEGES ... REVOKE ALL ON TABLES`), so every table created since
-- (including the 5 new Phase 7 tables) is already covered.
