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
