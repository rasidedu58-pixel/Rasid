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

# Restore in sections so the app's ONE documented platform prerequisite —
# the pg_trgm extension — can be provisioned AFTER the schemas/tables exist but
# BEFORE the trigram index is built.
#
# Why this is needed: a schema-restricted pg_dump (`--schema=public
# --schema=drizzle`) is, by PostgreSQL's own definition, NOT guaranteed to be
# self-contained — it does not emit `CREATE EXTENSION`. Rasid migration 0015
# runs `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (into public) and then builds
# `students_search_name_trgm_idx ... USING gin (... public.gin_trgm_ops)`.
# Recreating pg_trgm here reproduces the canonical Production prerequisite —
# exactly like the app-role pre-creation above. It provisions a documented
# prerequisite; it does NOT suppress any restore error. --exit-on-error is kept
# on every section, so a genuinely corrupt/incomplete backup still fails.
RESTORE_COMMON=(--no-owner --no-privileges --exit-on-error --dbname "$VERIFY_DB_URL")

log "restoring into disposable PostgreSQL (pre-data: schemas, tables, types, functions)…"
"$PG_RESTORE" "${RESTORE_COMMON[@]}" --section=pre-data "$DUMP" \
  || die "pg_restore (pre-data) failed"

log "provisioning documented platform prerequisite: pg_trgm (into public)…"
"$PSQL" "$VERIFY_DB_URL" -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;" \
  || die "could not provision pg_trgm prerequisite"

log "restoring data…"
"$PG_RESTORE" "${RESTORE_COMMON[@]}" --section=data "$DUMP" \
  || die "pg_restore (data) failed"

log "restoring post-data (indexes incl. GIN trigram, constraints, triggers, RLS)…"
"$PG_RESTORE" "${RESTORE_COMMON[@]}" --section=post-data "$DUMP" \
  || die "pg_restore (post-data) failed"

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

# Required extension / dependency: pg_trgm must be present in the restored DB.
[ "$(q "select count(*) from pg_extension where extname='pg_trgm'")" = "1" ] \
  || die "pg_trgm extension missing after restore"

# The GIN trigram index must exist AND actually be a gin_trgm_ops index — this
# proves the extension dependency and the index both restored correctly.
[ "$(q "select count(*) from pg_indexes where schemaname='public' and indexname='students_search_name_trgm_idx'")" = "1" ] \
  || die "trigram index students_search_name_trgm_idx missing after restore"
[ "$(q "select count(*) from pg_indexes where schemaname='public' and indexname='students_search_name_trgm_idx' and indexdef ilike '%using gin%gin_trgm_ops%'")" = "1" ] \
  || die "students_search_name_trgm_idx is not a GIN gin_trgm_ops index after restore"

# Queryability: a real SELECT against a key table must succeed (pipefail on).
STUDENTS_ROWS="$(q "select count(*) from public.students")"
case "$STUDENTS_ROWS" in ''|*[!0-9]*) die "restored DB is not queryable (select on public.students failed)";; esac

log "RESTORE VERIFICATION PASSED — key_tables=${KEY_TABLES} users_rls=1 rls_tables=${RLS_TABLES} migrations=${MIGRATIONS} pg_trgm=1 trigram_index=1 students_rows=${STUDENTS_ROWS}"
