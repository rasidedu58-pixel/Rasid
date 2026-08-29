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

# Derive the S3 signing region from a Backblaze endpoint. B2's SigV4 region is
# the middle token of the host, e.g.
#   https://s3.eu-central-003.backblazeb2.com -> eu-central-003
#   https://s3.us-west-004.backblazeb2.com    -> us-west-004
b2_region() {
  b2_endpoint | sed -E 's#^https?://##; s#^s3\.##; s#\.backblazeb2\.com/?$##'
}

# --- Centralised B2 (S3-compatible) client -----------------------------------
# EVERY B2 call — upload, head/list verification, retention, weekly restore —
# MUST go through b2_aws() so they can never diverge on endpoint, region or
# signing behaviour. b2_configure() must be called once before b2_aws().
#
# Notes on the SignatureDoesNotMatch class of failures on B2:
#  * The signing region MUST equal the endpoint's region token (b2_region);
#    high-level `aws s3 cp` auto-discovers and re-signs, but `aws s3api …`
#    does not, so a wrong/implicit region only surfaces on s3api verify/list.
#    We therefore pin --region explicitly on every call.
#  * AWS CLI v2 (>= 2.23) turns ON request/response integrity checksums by
#    default (aws-chunked / trailing checksums) which B2's S3 API rejects with
#    SignatureDoesNotMatch. We restore the pre-2.23 "when_required" behaviour.
b2_configure() {
  require_env B2_KEY_ID B2_APPLICATION_KEY B2_BUCKET_NAME B2_ENDPOINT
  export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY"
  export B2_EP B2_REGION
  B2_EP="$(b2_endpoint)"
  B2_REGION="$(b2_region)"
  # Pin region for both the SDK and any implicit resolution.
  export AWS_DEFAULT_REGION="$B2_REGION"
  export AWS_REGION="$B2_REGION"
  export AWS_EC2_METADATA_DISABLED=true
  # B2-compatibility: do not add SDK integrity checksums unless the operation
  # requires them (avoids SignatureDoesNotMatch on AWS CLI v2 >= 2.23).
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required
  export AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
}

# Backwards-compatible name kept for existing callers.
b2_aws_env() { b2_configure; }

# Run an aws command against B2 with the shared endpoint + region. Credentials
# live in the environment only and are never passed as arguments or printed.
b2_aws() {
  [ -n "${B2_EP:-}" ] && [ -n "${B2_REGION:-}" ] || b2_configure
  aws --endpoint-url "$B2_EP" --region "$B2_REGION" "$@"
}

# Assert one exact object exists (exact-key HeadObject, not a bucket listing).
b2_head_object() {
  local key="$1"
  b2_aws s3api head-object --bucket "$B2_BUCKET_NAME" --key "$key" >/dev/null 2>&1
}
