#!/usr/bin/env bash
# Rasid database backup. Installs to /opt/rasid/bin/backup-db.sh, run by
# /etc/cron.d/rasid as root.
#
# Scheduled at 02:30 deliberately: the neighbouring project dumps at 03:00 and
# prunes recordings around 03:31. On a 2-core box, overlapping those would make
# both slower and muddy any incident timeline.
#
# KEEP_DAYS controls retention. The restore test is a SEPARATE monthly job —
# a backup that has never been restored is a hope, not a backup.
set -euo pipefail

DB=rasid
DEST=/var/backups/rasid
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%d)"
FILE="$DEST/db-$STAMP.sql.gz"

mkdir -p "$DEST"
chmod 700 "$DEST"

# Dump as the cluster superuser so ownership/ACLs survive; compress inline to
# keep peak disk use low.
sudo -u postgres pg_dump --no-owner --no-acl --format=plain "$DB" | gzip -9 > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"

# Prove the dump is not silently empty or truncated before trusting it.
SIZE=$(stat -c %s "$FILE")
if [ "$SIZE" -lt 10240 ]; then
  echo "rasid-backup: FAIL dump suspiciously small ($SIZE bytes): $FILE" >&2
  exit 1
fi
if ! gzip -t "$FILE"; then
  echo "rasid-backup: FAIL gzip integrity check: $FILE" >&2
  exit 1
fi

find "$DEST" -name 'db-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete

echo "rasid-backup: ok $FILE ($SIZE bytes), retention ${KEEP_DAYS}d"

# NOTE — the gap the host's own runbook names explicitly: these dumps live on
# the same disk as the database. They survive a bad migration or a dropped
# table; they do NOT survive losing the server. And /etc/rasid/*.env (which
# holds the role passwords and the GoTrue signing key) is in neither git nor
# this dump. Copy both off-server.
