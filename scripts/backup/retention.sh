#!/usr/bin/env bash
#
# Retention: delete Production backup objects older than RETENTION_DAYS (30),
# scoped STRICTLY to the `production/` prefix, and NEVER delete the newest
# successful backup's object group (.dump + .dump.sha256 + .metadata.json).
#
# Inputs (env): B2_KEY_ID B2_APPLICATION_KEY B2_BUCKET_NAME B2_ENDPOINT
#               RETENTION_DAYS (default 30)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/lib.sh
source "$HERE/lib.sh"

b2_aws_env
EP="$(b2_endpoint)"
PREFIX="production/"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CUTOFF="$(date -u -d "${RETENTION_DAYS} days ago" +%s)"

OBJS="$(mktemp)"
trap 'rm -f "$OBJS"' EXIT
aws s3api list-objects-v2 \
  --bucket "$B2_BUCKET_NAME" \
  --prefix "$PREFIX" \
  --endpoint-url "$EP" \
  --output json > "$OBJS"

# Protect the newest .dump (by LastModified) and its sibling group — never delete it.
NEWEST_DUMP_KEY="$(jq -r '[.Contents[]? | select(.Key|endswith(".dump"))] | max_by(.LastModified) | .Key // empty' "$OBJS")"
if [ -z "$NEWEST_DUMP_KEY" ]; then
  log "no .dump objects under ${PREFIX} — nothing to prune"
  exit 0
fi
PROT_BASE="${NEWEST_DUMP_KEY%.dump}"
log "protected newest backup group: ${PROT_BASE}.{dump,dump.sha256,metadata.json}"

deleted=0
while IFS=$'\t' read -r KEY LM; do
  [ -n "$KEY" ] || continue
  # Defence in depth: only ever touch keys under production/.
  case "$KEY" in "$PREFIX"*) ;; *) warn "skipping out-of-scope key: $KEY"; continue;; esac
  # Never delete the protected newest group.
  case "$KEY" in
    "${PROT_BASE}.dump"|"${PROT_BASE}.dump.sha256"|"${PROT_BASE}.metadata.json") continue;;
  esac
  OBJ_EPOCH="$(date -u -d "$LM" +%s 2>/dev/null || echo 0)"
  if [ "$OBJ_EPOCH" -gt 0 ] && [ "$OBJ_EPOCH" -lt "$CUTOFF" ]; then
    aws s3api delete-object --bucket "$B2_BUCKET_NAME" --key "$KEY" --endpoint-url "$EP" >/dev/null
    log "deleted (older than ${RETENTION_DAYS}d): $KEY"
    deleted=$((deleted + 1))
  fi
done < <(jq -r '.Contents[]? | [.Key, .LastModified] | @tsv' "$OBJS")

log "retention complete — ${deleted} object(s) deleted, newest backup preserved"
