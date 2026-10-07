-- 0074 — Self-hosted VPS: fix the database name in CONNECT grants, and cap the
-- GoTrue auth role.
--
-- ── Part 1: CONNECT was granted on the wrong database ──────────────────────
-- 0006, 0032 and 0048 each issued:
--     GRANT CONNECT ON DATABASE postgres TO <role>;
-- `postgres` was Supabase's database name. On this cluster the application
-- database is `rasid`, and `postgres` is the shared maintenance database that
-- the neighbouring project's cluster also uses. So those three statements did
-- two wrong things at once: they granted Rasid's roles CONNECT on a database
-- they have no business reaching, and they never granted it on the database
-- they actually use.
--
-- Nothing is broken TODAY only because PostgreSQL gives CONNECT to PUBLIC on
-- every new database by default. That is a latent trap, not a safeguard: the
-- standard hardening step `REVOKE CONNECT ON DATABASE rasid FROM PUBLIC` would
-- instantly lock all three application roles out of production.
--
-- Fixed forward (0006/0032/0048 are not edited — migrations are forward-only):
-- grant CONNECT explicitly on the CURRENT database, whatever it is called, so
-- this is correct on the VPS and on any future environment. `current_database()`
-- cannot be used directly in GRANT, hence the EXECUTE.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_platform_admin', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_worker', current_database());
END
$$;
--> statement-breakpoint

-- Withdraw the three EXPLICIT grants on the shared maintenance database.
--
-- Note what this does and does not achieve, verified on PostgreSQL 16.15: it
-- removes the `app_*=c/postgres` entries from that database's ACL, but PUBLIC
-- keeps its default `=Tc` (TEMPORARY + CONNECT) there, so the roles can still
-- technically connect by virtue of being PUBLIC. Revoking PUBLIC's access on
-- the shared `postgres` database would affect the neighbouring project and is
-- deliberately out of scope. What matters is that Rasid no longer asserts a
-- privilege of its own on a database it does not use.
--
-- Guarded: a cluster with no `postgres` database must not fail the migration,
-- and REVOKE of a privilege that was never granted is a harmless no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = 'postgres')
     AND current_database() <> 'postgres' THEN
    REVOKE CONNECT ON DATABASE postgres FROM app_runtime;
    REVOKE CONNECT ON DATABASE postgres FROM app_platform_admin;
    REVOKE CONNECT ON DATABASE postgres FROM app_worker;
  END IF;
END
$$;
--> statement-breakpoint

-- ── Part 2: the auth role was missing from the connection budget ───────────
-- 0073 sized the budget as 14 + 4 + 4 = 22 for the application roles against
-- 47 usable, with the neighbouring project measured at 15 — leaving 10 spare.
-- That arithmetic omitted `rasid_auth`, the role self-hosted GoTrue connects
-- with. Uncapped, GoTrue's pool is free to consume exactly the headroom the
-- budget relies on.
--
-- 7 = GOTRUE_DB_MAX_POOL_SIZE (5, now set explicitly in gotrue.env) plus 2 for
-- transient overlap during a restart. Revised budget:
--     app roles 22 + rasid_auth 7 + neighbour 15 = 44 of 47 worst case.
-- Tighter than 0073 claimed, and now actually accounted for rather than
-- unbounded.
--
-- Guarded because `rasid_auth` is created out-of-band per environment (it owns
-- the `auth` schema and is deliberately not created by these migrations), so a
-- developer machine or CI database will not have it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rasid_auth') THEN
    EXECUTE 'ALTER ROLE rasid_auth CONNECTION LIMIT 7';
  END IF;
END
$$;
