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
b2_aws_env
EP="$(b2_endpoint)"
DEST="s3://${B2_BUCKET_NAME}/${KEY_PREFIX}"

for f in "$DUMP" "$SHA" "$META"; do
  [ -s "$f" ] || die "artifact missing/empty before upload: $f"
  name="$(basename "$f")"
  aws s3 cp "$f" "${DEST}/${name}" --endpoint-url "$EP" --only-show-errors
  log "uploaded: ${KEY_PREFIX}/${name}"
done

# Confirm the .dump is listable at its destination (upload actually landed).
aws s3 ls "${DEST}/$(basename "$DUMP")" --endpoint-url "$EP" >/dev/null \
  || die "post-upload verification failed — dump not found in bucket"
log "upload verified in bucket ${B2_BUCKET_NAME} under ${KEY_PREFIX}/"
