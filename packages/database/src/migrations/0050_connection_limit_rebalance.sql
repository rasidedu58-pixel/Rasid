-- 0050 — Phase 15B: role CONNECTION LIMIT rebalance, from measured evidence.
--
-- Live-measured layer map (2026-08-26, this project):
--   Postgres backend max_connections ........ 60
--   Supabase internal services (observed) ... ~14 idle-to-normal
--   Supavisor SESSION-mode client cap ....... 15  (EMAXCONNSESSION, reproduced)
--   app_runtime role limit (old) ............ 20  (error 53300, reproduced —
--                                                  and it FAILS, not queues,
--                                                  when transaction-mode
--                                                  backend demand exceeds it)
--
-- Budget after this migration (backend connections):
--   app_runtime ......... 28   (API replicas × their pool must stay under
--                               this — e.g. 1 replica × pool 20, or
--                               2 × 12; pool size is env-tunable via
--                               DB_POOL_MAX, see connection.ts)
--   app_worker ..........  5   (worker pool default is now 3 → real slack)
--   app_platform_admin ..  3   (backoffice pool default is now 2)
--   sum(app roles) ...... 36
--   supabase internals .. ~14
--   migration/admin ..... ~2 transient
--   total worst case .... ~52 of 60 → ~8 connections true headroom (13%)
--
-- Deliberately NOT maxing out: sum(limits) == max_connections would turn
-- any Supabase-internal connection spike into hard 53300 failures for the
-- product. If more parallelism is needed later, the next step is a
-- Supabase compute/plan tier with a higher max_connections — not shaving
-- this reserve.

ALTER ROLE "app_runtime" CONNECTION LIMIT 28;
--> statement-breakpoint
ALTER ROLE "app_worker" CONNECTION LIMIT 5;
--> statement-breakpoint
ALTER ROLE "app_platform_admin" CONNECTION LIMIT 3;
