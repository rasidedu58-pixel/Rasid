#!/usr/bin/env bash
#
# Upload the three backup artifacts to Backblaze B2 (S3-compatible API).
# Credentials come only from env (B2 secrets); nothing is printed.
#
# Inputs (env): B2_KEY_ID B2_APPLICATION_KEY B2_BUCKET_NAME B2_ENDPOINT
#               DUMP SHA META KEY_PREFIX  (exported by backup.sh)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
source "$HERE/lib.sh"

require_env DUMP SHA META KEY_PREFIX
b2_configure

# Deterministic single-request PutObject from the real local file path.
#
# We deliberately do NOT use `aws s3 cp`: its transfer manager can send the body
# with aws-chunked / streaming payload signing (and may switch to multipart),
# which Backblaze B2 miscounts as "IncompleteBody: request body too small".
# `s3api put-object --body <file>` issues one plain PutObject with a real
# Content-Length and a full-payload signature — the B2-compatible path. Each
# object is then verified so a printed line is never mistaken for proof.
upload_and_verify() {
  local f="$1" key size remote
  # Pre-upload assertions: file exists and has a real, non-zero size.
  [ -f "$f" ] || die "artifact not found before upload: $f"
  size="$(stat -c%s "$f")"
  [ -n "$size" ] && [ "$size" -gt 0 ] || die "artifact is empty (0 bytes): $f"
  key="${KEY_PREFIX}/$(basename "$f")"
  log "uploading: $(basename "$f") | local=${size} bytes | key=${key}"

  b2_aws s3api put-object \
    --bucket "$B2_BUCKET_NAME" \
    --key "$key" \
    --body "$f" >/dev/null \
    || die "put-object failed for ${key}"

  # Post-upload: object must exist AND remote ContentLength must match exactly.
  remote="$(b2_aws s3api head-object --bucket "$B2_BUCKET_NAME" --key "$key" \
              --query 'ContentLength' --output text 2>/dev/null || true)"
  case "$remote" in
    ''|None)  die "post-upload verification FAILED — object missing: ${key}";;
    *[!0-9]*) die "post-upload verification FAILED — non-numeric ContentLength for ${key}";;
  esac
  [ "$remote" = "$size" ] \
    || die "post-upload verification FAILED — size mismatch for ${key}: local=${size} remote=${remote}"
  log "verified: key=${key} | local=${size} | remote ContentLength=${remote}"
}

upload_and_verify "$DUMP"
upload_and_verify "$SHA"
upload_and_verify "$META"
log "upload + verification PASSED — all 3 objects present with exact byte sizes in ${B2_BUCKET_NAME}/${KEY_PREFIX}/"
