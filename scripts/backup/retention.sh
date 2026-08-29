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

PREFIX="production/"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
CUTOFF="$(date -u -d "${RETENTION_DAYS} days ago" +%s)"

# Object inventory via the single boto3 B2 client. TSV: <key>\t<epoch>\t<size>.
OBJS="$(mktemp)"
trap 'rm -f "$OBJS"' EXIT
b2py list --prefix "$PREFIX" > "$OBJS"

# Protect the newest .dump (by LastModified epoch) and its sibling group.
NEWEST_DUMP_KEY="$(awk -F'\t' '$1 ~ /\.dump$/ {print $2"\t"$1}' "$OBJS" | sort -rn | head -1 | cut -f2)"
if [ -z "$NEWEST_DUMP_KEY" ]; then
  log "no .dump objects under ${PREFIX} — nothing to prune"
  exit 0
fi
PROT_BASE="${NEWEST_DUMP_KEY%.dump}"
log "protected newest backup group: ${PROT_BASE}.{dump,dump.sha256,metadata.json}"

deleted=0
while IFS=$'\t' read -r KEY EPOCH SIZE; do
  [ -n "$KEY" ] || continue
  # Defence in depth: only ever touch keys under production/.
  case "$KEY" in "$PREFIX"*) ;; *) warn "skipping out-of-scope key: $KEY"; continue;; esac
  # Never delete the protected newest group.
  case "$KEY" in
    "${PROT_BASE}.dump"|"${PROT_BASE}.dump.sha256"|"${PROT_BASE}.metadata.json") continue;;
  esac
  case "$EPOCH" in ''|*[!0-9]*) continue;; esac
  if [ "$EPOCH" -gt 0 ] && [ "$EPOCH" -lt "$CUTOFF" ]; then
    b2py delete --key "$KEY" >/dev/null
    log "deleted (older than ${RETENTION_DAYS}d): $KEY"
    deleted=$((deleted + 1))
  fi
done < "$OBJS"

log "retention complete — ${deleted} object(s) deleted, newest backup preserved"
