-- 0074 — VERIFY the cluster-level settings the self-hosted VPS needs.
--
-- ── WHY THIS MIGRATION ONLY CHECKS, AND DOES NOT APPLY ────────────────────
-- Two things need fixing on the self-hosted cluster, and NEITHER is a schema
-- change:
--
--   1. CONNECT on the application database. 0006, 0032 and 0048 each issued
--      `GRANT CONNECT ON DATABASE postgres TO <role>` — "postgres" was
--      Supabase's database name. Here the application database is `rasid`,
--      and `postgres` is the shared maintenance database of a cluster this
--      project does not own alone. So those statements granted a privilege on
--      the wrong database and never granted it on the right one. Nothing is
--      broken today only because PostgreSQL gives CONNECT to PUBLIC by
--      default — which means the ordinary hardening step
--      `REVOKE CONNECT ON DATABASE rasid FROM PUBLIC` would instantly lock
--      all three application roles out of production.
--
--   2. A connection cap on `rasid_auth`. Migration 0073 budgeted 14+4+4 for
--      the application roles against 47 usable on a cluster shared with an
--      unrelated product, and omitted the role GoTrue connects with. Left
--      uncapped it is free to consume the entire stated headroom.
--
-- Both are CLUSTER-level operations: granting on a database requires owning
-- it, and altering a role requires ADMIN OPTION on that role — which, since
-- PostgreSQL 16, CREATEROLE alone does not confer. The migration role holds
-- neither. It owns the `app_*` roles because the migrations create them (so
-- 0073's ALTER ROLE statements work), but `rasid_auth` and the database
-- itself are created out-of-band by a superuser.
--
-- An earlier version of this file tried to DO the work. Run as the migration
-- role it failed outright on ALTER ROLE; made tolerant, it "succeeded" while
-- silently changing nothing and would have been recorded as applied. Both
-- outcomes are wrong. A least-privilege migration must not claim authority it
-- does not have — so this one asserts the required state and tells the
-- operator exactly what to run as a superuser when it is missing.
--
-- The privileged counterpart lives at deploy/sql/0074-cluster-privileged.sql
-- and is run once, as postgres, on the server.
DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
  v_limit   integer;
BEGIN
  -- Dev machines and CI have no rasid_auth and no shared neighbour; there is
  -- no cluster to assert anything about, so this is a no-op there.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rasid_auth') THEN
    RAISE NOTICE '0074: rasid_auth absent (dev/CI cluster) — cluster checks skipped.';
    RETURN;
  END IF;

  IF NOT has_database_privilege('app_runtime', current_database(), 'CONNECT')
     OR NOT EXISTS (
       SELECT 1 FROM pg_database
       WHERE datname = current_database()
         AND array_to_string(datacl, ',') LIKE '%app_runtime=%c%'
     ) THEN
    v_missing := v_missing || 'app_runtime lacks an EXPLICIT CONNECT grant'::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_database
    WHERE datname = current_database()
      AND array_to_string(datacl, ',') LIKE '%app_platform_admin=%c%'
  ) THEN
    v_missing := v_missing || 'app_platform_admin lacks an EXPLICIT CONNECT grant'::text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_database
    WHERE datname = current_database()
      AND array_to_string(datacl, ',') LIKE '%app_worker=%c%'
  ) THEN
    v_missing := v_missing || 'app_worker lacks an EXPLICIT CONNECT grant'::text;
  END IF;

  SELECT rolconnlimit INTO v_limit FROM pg_roles WHERE rolname = 'rasid_auth';
  IF v_limit IS NULL OR v_limit < 0 OR v_limit > 10 THEN
    v_missing := v_missing || format('rasid_auth CONNECTION LIMIT is %s, expected 7', v_limit)::text;
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION E'0074: required cluster configuration is missing:\n  - %\n\nThese need a superuser. Run ONCE on the server:\n  sudo -u postgres psql -d % -f deploy/sql/0074-cluster-privileged.sql\nthen re-run the migration.',
      array_to_string(v_missing, E'\n  - '), current_database();
  END IF;

  RAISE NOTICE '0074: cluster configuration verified.';
END
$$;
