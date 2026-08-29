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
DEST="s3://${B2_BUCKET_NAME}/${KEY_PREFIX}"

for f in "$DUMP" "$SHA" "$META"; do
  [ -s "$f" ] || die "artifact missing/empty before upload: $f"
  name="$(basename "$f")"
  b2_aws s3 cp "$f" "${DEST}/${name}" --only-show-errors
  log "uploaded: ${KEY_PREFIX}/${name}"
done

# Post-upload verification: prove EACH of the three objects exists using an
# exact-key HeadObject (not a bucket listing). This is the authoritative check —
# a printed "uploaded" line is NOT proof the object landed.
verify_one() {
  local key="$1" size
  size="$(b2_aws s3api head-object --bucket "$B2_BUCKET_NAME" --key "$key" \
            --query 'ContentLength' --output text 2>/dev/null || true)"
  case "$size" in
    ''|None|0) die "post-upload verification FAILED — object missing or empty: ${key}";;
    *[!0-9]*)  die "post-upload verification FAILED — unexpected size for ${key}";;
  esac
  log "verified in bucket: ${key} (${size} bytes)"
}
verify_one "${KEY_PREFIX}/$(basename "$DUMP")"
verify_one "${KEY_PREFIX}/$(basename "$SHA")"
verify_one "${KEY_PREFIX}/$(basename "$META")"
log "post-upload verification PASSED — all 3 objects present in ${B2_BUCKET_NAME}/${KEY_PREFIX}/"
