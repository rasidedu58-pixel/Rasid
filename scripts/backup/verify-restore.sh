#!/usr/bin/env bash
#
# Weekly restore verification. Downloads the newest Production backup from B2,
# verifies its SHA-256, and restores it into a DISPOSABLE PostgreSQL 17 service
# (localhost only — never Production/Staging), then asserts the restore is
# structurally sound. The service container is destroyed by GitHub Actions at
# job end. This job never connects to Production for anything but read (it does
# not connect to Production at all — it reads the B2 object).
#
# Inputs (env): B2_KEY_ID B2_APPLICATION_KEY B2_BUCKET_NAME B2_ENDPOINT
#               VERIFY_DB_URL  (disposable target, e.g. postgres://postgres:postgres@localhost:5432/postgres)
#               WORKDIR (default ./_verify)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
source "$HERE/lib.sh"

require_env VERIFY_DB_URL
case "$VERIFY_DB_URL" in
  *@localhost:*|*@127.0.0.1:*) ;;
  *) die "refusing to run: VERIFY_DB_URL must target a local disposable instance (got a non-localhost host)";;
esac
# Enforce PG17 client (dump was produced by PG17; restore/psql must match).
require_pg17
PG_RESTORE="$(pgbin pg_restore)"
PSQL="$(pgbin psql)"
require_env B2_KEY_ID B2_APPLICATION_KEY B2_BUCKET_NAME B2_ENDPOINT
WORKDIR="${WORKDIR:-./_verify}"; mkdir -p "$WORKDIR"

# Object inventory via the single native B2 client. TSV: <key>\t<epoch>\t<size>\t<fileId>.
OBJS="$(mktemp)"; trap 'rm -f "$OBJS"' EXIT
b2py list --prefix "production/" > "$OBJS"
NEWEST="$(awk -F'\t' '$1 ~ /\.dump$/ {print $2"\t"$1}' "$OBJS" | sort -rn | head -1 | cut -f2)"
[ -n "$NEWEST" ] || die "no Production backup (.dump) found under production/"
BASE="${NEWEST%.dump}"
log "newest backup: $NEWEST"

DUMP="${WORKDIR}/restore.dump"
# Single-request GetObject via the same B2 client (no managed multipart).
b2py get --key "$NEWEST"            --file "$DUMP"
b2py get --key "${BASE}.dump.sha256" --file "${DUMP}.sha256"
[ -s "$DUMP" ] || die "downloaded dump is empty"

# Verify checksum.
EXPECT="$(cat "${DUMP}.sha256")"
ACTUAL="$(sha256sum "$DUMP" | awk '{print $1}')"
[ "$EXPECT" = "$ACTUAL" ] || die "SHA-256 mismatch (expected ${EXPECT}, got ${ACTUAL})"
log "SHA-256 verified: ${ACTUAL}"

# Confirm the archive is readable before attempting a restore.
"$PG_RESTORE" --list "$DUMP" >/dev/null || die "pg_restore --list failed — archive unreadable"

# The dump (--no-owner --no-privileges) still contains CREATE POLICY ... TO <role>
# statements; those roles are cluster-global and NOT in the dump, so pre-create
# them as harmless NOLOGIN roles in the disposable target before restore.
"$PSQL" "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_runtime','app_worker','app_platform_admin','anon','authenticated','service_role','authenticator'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', r);
    END IF;
  END LOOP;
END $$;
SQL

# Present a genuinely CLEAN target. The dump was taken with
# --schema=public --schema=drizzle, so its TOC contains `CREATE SCHEMA public;`
# (and `CREATE SCHEMA drizzle;`). A fresh PostgreSQL database already ships an
# empty `public` schema, so that statement would fail with
# `schema "public" already exists` and abort the (correctly strict) restore.
# Drop the pre-existing schemas first so the dump recreates them itself; this
# ONLY ever touches the disposable localhost instance (guarded at the top).
"$PSQL" "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
SQL

log "restoring into disposable PostgreSQL…"
# Keep --exit-on-error: any genuine restore error still fails verification.
"$PG_RESTORE" --no-owner --no-privileges --exit-on-error --dbname "$VERIFY_DB_URL" "$DUMP" \
  || die "pg_restore failed"

# ---- Assertions on the restored disposable database ----
q() { "$PSQL" "$VERIFY_DB_URL" -tAX -c "$1" | tr -d '[:space:]'; }

[ "$(q "select count(*) from information_schema.schemata where schema_name='public'")"  = "1" ] || die "public schema missing after restore"
[ "$(q "select count(*) from information_schema.schemata where schema_name='drizzle'")" = "1" ] || die "drizzle schema missing after restore"

KEY_TABLES="$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('users','workspaces','students','sessions','financial_obligations','memberships')")"
[ "$KEY_TABLES" = "6" ] || die "expected 6 key Rasid tables, found ${KEY_TABLES}"

USERS_RLS="$(q "select coalesce(bool_or(relrowsecurity)::int,0) from pg_class where relname='users' and relnamespace='public'::regnamespace")"
[ "$USERS_RLS" = "1" ] || die "RLS is NOT enabled on public.users after restore"

RLS_TABLES="$(q "select count(*) from pg_class where relnamespace='public'::regnamespace and relrowsecurity")"
[ "${RLS_TABLES:-0}" -ge 30 ] || die "too few RLS-enabled tables restored (${RLS_TABLES})"

MIGRATIONS="$(q "select count(*) from drizzle.__drizzle_migrations")"
[ "${MIGRATIONS:-0}" -ge 1 ] || die "no Drizzle migration state restored"

log "RESTORE VERIFICATION PASSED — key_tables=${KEY_TABLES} users_rls=1 rls_tables=${RLS_TABLES} migrations=${MIGRATIONS}"
