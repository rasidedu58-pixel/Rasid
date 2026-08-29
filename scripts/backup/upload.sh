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

# Upload one artifact via the native B2 client (single plain POST of the real
# local file), then independently re-verify the remote byte size here.
upload_and_verify() {
  local f="$1" key size remote
  # Pre-upload assertions: file exists and has a real, non-zero size.
  [ -f "$f" ] || die "artifact not found before upload: $f"
  size="$(stat -c%s "$f")"
  [ -n "$size" ] && [ "$size" -gt 0 ] || die "artifact is empty (0 bytes): $f"
  key="${KEY_PREFIX}/$(basename "$f")"
  log "uploading: $(basename "$f") | local=${size} bytes | key=${key}"

  # b2.py put uploads AND asserts remote ContentLength == local size internally.
  b2py put --key "$key" --file "$f" || die "B2 put/verify failed for ${key}"

  # Independent second confirmation from bash: HeadObject size must match.
  remote="$(b2py head --key "$key" 2>/dev/null || true)"
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
