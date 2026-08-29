#!/usr/bin/env bash
# Shared helpers for the Rasid Production backup scripts. Sourced, not executed.
#
# SECURITY: never enable `set -x` here or in any caller — it would echo the
# connection URL / B2 keys. Secrets are read from the environment only and are
# never printed. GitHub Actions additionally masks registered secrets in logs.

log()  { printf '[backup] %s\n' "$*"; }
warn() { printf '::warning::[backup] %s\n' "$*"; }
die()  { printf '::error::[backup] %s\n' "$*" >&2; exit 1; }

require_env() {
  local v
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then die "required environment variable is not set: $v"; fi
  done
}

# --- PostgreSQL 17 client resolution (do NOT rely on PATH ordering) ---------
# The runner ships a PG16 client at /usr/bin; postgresql-client-17 installs to
# /usr/lib/postgresql/17/bin. Resolve the PG17 bindir deterministically.

pg17_bindir() {
  local d
  if [ -n "${PG17_BINDIR:-}" ] && [ -x "${PG17_BINDIR}/pg_dump" ]; then
    printf '%s' "$PG17_BINDIR"; return 0
  fi
  for d in /usr/lib/postgresql/17/bin /usr/pgsql-17/bin /opt/homebrew/opt/postgresql@17/bin; do
    if [ -x "$d/pg_dump" ]; then printf '%s' "$d"; return 0; fi
  done
  return 0  # none found; pgbin() falls back to PATH, require_pg17 still gates.
}

# Absolute path to a PG17 client binary (pg_dump / pg_restore / psql). Falls
# back to the bare name only if no pinned dir was found (the gate still guards).
pgbin() {
  local name="$1" dir; dir="$(pg17_bindir)"
  if [ -n "$dir" ] && [ -x "$dir/$name" ]; then printf '%s' "$dir/$name"; else printf '%s' "$name"; fi
}

# Major version of a resolved client binary (e.g. pg_dump -> 17).
_pg_major() { "$(pgbin "$1")" --version 2>/dev/null | grep -oE '[0-9]+' | head -1; }

# HARD GATE: pg_dump AND pg_restore must be major version 17, else abort.
require_pg17() {
  local dver rver
  dver="$(_pg_major pg_dump || true)"
  rver="$(_pg_major pg_restore || true)"
  [ "$dver" = "17" ] || die "pg_dump major version must be 17 (resolved '$(pgbin pg_dump)' = ${dver:-none}); refusing to run"
  [ "$rver" = "17" ] || die "pg_restore major version must be 17 (resolved '$(pgbin pg_restore)' = ${rver:-none}); refusing to run"
  log "PostgreSQL 17 client confirmed (pg_dump=${dver}, pg_restore=${rver}) at $(pg17_bindir)"
}

# Normalise the Backblaze S3 endpoint to always include a scheme.
b2_endpoint() {
  local ep="${B2_ENDPOINT:?B2_ENDPOINT is required}"
  case "$ep" in http://*|https://*) printf '%s' "$ep";; *) printf 'https://%s' "$ep";; esac
}

# Derive the S3 region from a Backblaze endpoint,
# e.g. https://s3.us-west-004.backblazeb2.com -> us-west-004
b2_region() {
  b2_endpoint | sed -E 's#^https?://##; s#^s3\.##; s#\.backblazeb2\.com/?$##'
}

# Export aws-cli credentials/region from the B2 secrets. Values are never printed.
b2_aws_env() {
  require_env B2_KEY_ID B2_APPLICATION_KEY B2_BUCKET_NAME B2_ENDPOINT
  export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY"
  export AWS_DEFAULT_REGION="$(b2_region)"
  export AWS_EC2_METADATA_DISABLED=true
}
