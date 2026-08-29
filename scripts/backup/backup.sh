#!/usr/bin/env bash
#
# Create + validate a Production logical backup with pg_dump (custom format).
# READ-ONLY against Production (a pg_dump plus one `show server_version`).
#
# Inputs (env):
#   SUPABASE_PROD_DB_URL  (secret) postgres admin Session Pooler URI (port 5432)
#   PROJECT_REF           production project ref (non-secret)
#   GIT_SHA               commit sha for provenance
#   WORKDIR               output directory (default ./_backup)
#
# Outputs written to $WORKDIR and exported to $GITHUB_ENV for later steps:
#   <base>.dump  <base>.dump.sha256  <base>.metadata.json
#   DUMP / SHA / META / BASENAME / KEY_PREFIX
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
source "$HERE/lib.sh"

require_env SUPABASE_PROD_DB_URL
PROJECT_REF="${PROJECT_REF:-sbzksiidurpofzteyxsu}"
GIT_SHA="${GIT_SHA:-unknown}"
WORKDIR="${WORKDIR:-./_backup}"
mkdir -p "$WORKDIR"

TS="$(date -u +%Y-%m-%d-%H%M%S)"
DATE_PATH="$(date -u +%Y/%m/%d)"
BASENAME="rasid-production-${TS}"
DUMP="${WORKDIR}/${BASENAME}.dump"
SHA="${DUMP}.sha256"
META="${WORKDIR}/${BASENAME}.metadata.json"
KEY_PREFIX="production/${DATE_PATH}"
TOC="${WORKDIR}/toc.txt"

# HARD GATE before any Production access: the client MUST be PostgreSQL 17,
# otherwise pg_dump aborts on server (17.6) vs client (16.x) version mismatch.
require_pg17
PG_DUMP="$(pgbin pg_dump)"
PG_RESTORE="$(pgbin pg_restore)"
PSQL="$(pgbin psql)"
log "pg_dump client: $("$PG_DUMP" --version)"

# Read-only server version (single SELECT; the URL is never echoed).
SERVER_VERSION="$("$PSQL" "$SUPABASE_PROD_DB_URL" -tAX -c 'show server_version' 2>/dev/null | tr -d '[:space:]' || true)"
[ -n "$SERVER_VERSION" ] && log "source PostgreSQL server_version: $SERVER_VERSION" || warn "could not read server_version (continuing)"

# Custom-format dump of ONLY the app schemas — `public` (schema, data, indexes,
# constraints, sequences, functions, triggers, RLS policies) and `drizzle`
# (migration state). Restricting schemas avoids Supabase-managed system schemas
# the postgres role cannot fully dump, while keeping everything Rasid needs.
log "running pg_dump (custom format, public + drizzle)…"
"$PG_DUMP" "$SUPABASE_PROD_DB_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --schema=public --schema=drizzle \
  --file="$DUMP"

[ -s "$DUMP" ] || die "dump missing or empty: $DUMP"

# Checksum
sha256sum "$DUMP" | awk '{print $1}' > "$SHA"
SHA256="$(cat "$SHA")"
SIZE="$(stat -c%s "$DUMP")"
log "dump size: ${SIZE} bytes, sha256: ${SHA256}"

# Validate the artifact is a readable pg_restore archive.
"$PG_RESTORE" --list "$DUMP" > "$TOC" || die "pg_restore --list failed — dump is not readable"
[ -s "$TOC" ] || die "pg_restore --list produced an empty table of contents"

# Lightweight sanity: required objects MUST be present; others are warnings.
require_toc() { grep -qiE "$1" "$TOC" || die "sanity check failed — not in dump: $2"; }
require_toc ' TABLE public users( |$)|TABLE DATA public users' 'public.users'
require_toc ' TABLE public workspaces( |$)|TABLE DATA public workspaces' 'public.workspaces'
require_toc 'drizzle __drizzle_migrations' 'drizzle migration state'
for t in students sessions financial_obligations memberships payments; do
  grep -qiE " public $t( |$)|TABLE DATA public $t" "$TOC" || warn "expected table not found in TOC: public.$t"
done
grep -qi 'POLICY' "$TOC" || warn "no RLS POLICY entries found in TOC"

# Metadata (NO secrets, NO connection string).
cat > "$META" <<JSON
{
  "source": "Production",
  "supabaseRef": "${PROJECT_REF}",
  "utcTimestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "postgresSourceVersion": "${SERVER_VERSION}",
  "gitCommit": "${GIT_SHA}",
  "artifact": "${BASENAME}.dump",
  "artifactSizeBytes": ${SIZE},
  "sha256": "${SHA256}",
  "backupMethod": "pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=drizzle",
  "keyPrefix": "${KEY_PREFIX}",
  "verification": "toc-readable+sanity-passed"
}
JSON

# Hand file locations to subsequent workflow steps.
if [ -n "${GITHUB_ENV:-}" ]; then
  {
    echo "DUMP=${DUMP}"
    echo "SHA=${SHA}"
    echo "META=${META}"
    echo "BASENAME=${BASENAME}"
    echo "KEY_PREFIX=${KEY_PREFIX}"
  } >> "$GITHUB_ENV"
fi

log "backup ready: ${KEY_PREFIX}/${BASENAME}.dump"
