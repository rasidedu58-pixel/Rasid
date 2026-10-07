-- Cluster-level configuration for Rasid. Run ONCE, as a superuser, on the
-- server, against the application database:
--
--     sudo -u postgres psql -d rasid -f 0074-cluster-privileged.sql
--
-- Migration 0074 only VERIFIES this state — it cannot apply it. Granting on a
-- database requires owning it, and altering a role requires ADMIN OPTION on
-- that role (CREATEROLE alone is not enough since PostgreSQL 16). The
-- least-privilege migration role holds neither, by design.
--
-- Safe to re-run: every statement is idempotent.

\set ON_ERROR_STOP on

-- 1. CONNECT on the database the application actually uses.
--    0006/0032/0048 granted it on "postgres" — Supabase's database name, and
--    here the shared maintenance database of a cluster this project shares
--    with an unrelated product. Until these explicit grants exist, the roles
--    reach the database only through PUBLIC's default, so the ordinary
--    hardening step REVOKE CONNECT ... FROM PUBLIC would lock them out.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_platform_admin', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_worker', current_database());
END
$$;

-- 2. Withdraw the misplaced grants on the shared maintenance database.
--    This removes the app_*=c entries from its ACL. PUBLIC keeps its default
--    CONNECT there; revoking that would affect the neighbouring project and is
--    deliberately out of scope. The point is that Rasid no longer asserts a
--    privilege of its own on a database it does not use.
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

-- 3. Cap the role GoTrue connects with. 0073's budget (14+4+4 of 47 usable,
--    with a measured 15 for the neighbour) omitted it entirely. 7 = the
--    GOTRUE_DB_MAX_POOL_SIZE of 5 set in gotrue.env, plus 2 for transient
--    overlap across a restart. Revised worst case: 22 + 7 + 15 = 44 of 47.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rasid_auth') THEN
    EXECUTE 'ALTER ROLE rasid_auth CONNECTION LIMIT 7';
  END IF;
END
$$;

\echo 'Cluster configuration applied. Now re-run: pnpm --filter @academic-precision/database db:migrate'
