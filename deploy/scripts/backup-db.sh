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

# Dump as the cluster superuser so ownership and ACLs survive.
#
# `--no-acl` IS NOT SAFE HERE and was removed. 38 migrations issue GRANTs —
# every privilege `app_runtime`, `app_platform_admin` and `app_worker` hold is
# an ACL. Stripping them produced a dump that restores a complete-looking
# schema which the application roles then cannot read or write at all: a
# backup that passes inspection and fails in a real recovery.
#
# `--no-owner` is likewise dropped so object ownership is preserved — notably
# GoTrue's `auth` schema, which `rasid_auth` must own to run its own
# migrations. Restoring it owned by `postgres` leaves auth unable to write.
#
# Roles themselves are global to the cluster and are NOT in a per-database
# dump, so their definitions are captured separately. Passwords are included,
# which is why this file is 600 and belongs in the same off-server copy as
# /etc/rasid/*.env. It is scoped to Rasid's own roles: the neighbouring
# project's roles are not ours to dump.
sudo -u postgres pg_dump --format=plain "$DB" | gzip -9 > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
chmod 600 "$FILE"

ROLEFILE="$DEST/roles-$STAMP.sql"
sudo -u postgres pg_dumpall --roles-only \
  | grep -E 'app_runtime|app_platform_admin|app_worker|rasid_auth' \
  > "$ROLEFILE.tmp"
mv "$ROLEFILE.tmp" "$ROLEFILE"
chmod 600 "$ROLEFILE"

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

# A role dump with no matching lines means the grep found nothing — either the
# roles are gone or the pattern stopped matching. Either way, do not call it ok.
if [ ! -s "$ROLEFILE" ]; then
  echo "rasid-backup: FAIL role dump is empty: $ROLEFILE" >&2
  exit 1
fi

find "$DEST" -name 'db-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete
find "$DEST" -name 'roles-*.sql' -type f -mtime "+$KEEP_DAYS" -delete

echo "rasid-backup: ok $FILE ($SIZE bytes) + $ROLEFILE, retention ${KEEP_DAYS}d"

# NOTE — the gap the host's own runbook names explicitly: these dumps live on
# the same disk as the database. They survive a bad migration or a dropped
# table; they do NOT survive losing the server. And /etc/rasid/*.env (which
# holds the role passwords and the GoTrue signing key) is in neither git nor
# this dump. Copy both off-server.
