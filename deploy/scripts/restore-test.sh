#!/usr/bin/env bash
# Monthly proof that the newest backup actually restores. Installs to
# /opt/rasid/bin/restore-test.sh, run by /etc/cron.d/rasid.
#
# It restores into a THROWAWAY database and drops it afterwards. It never
# touches the live `rasid` database.
set -euo pipefail

DEST=/var/backups/rasid
SCRATCH="rasid_restore_test_$(date -u +%s)"

NEWEST="$(find "$DEST" -name 'db-*.sql.gz' -type f -printf '%T@ %p\n' | sort -rn | head -1 | cut -d' ' -f2-)"
[ -n "$NEWEST" ] || { echo "rasid-restore-test: FAIL no backup found in $DEST" >&2; exit 1; }

cleanup() { sudo -u postgres dropdb --if-exists "$SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT

sudo -u postgres createdb "$SCRATCH" --encoding=UTF8 --lc-collate=en_US.UTF-8 --lc-ctype=en_US.UTF-8 --template=template0
gzip -dc "$NEWEST" | sudo -u postgres psql --quiet --set ON_ERROR_STOP=1 --dbname "$SCRATCH" >/dev/null

# A restore that produces an empty schema is a failure, not a success.
TABLES=$(sudo -u postgres psql -At --dbname "$SCRATCH" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
if [ "$TABLES" -lt 20 ]; then
  echo "rasid-restore-test: FAIL restored only $TABLES public tables from $NEWEST" >&2
  exit 1
fi

echo "rasid-restore-test: ok $NEWEST restored $TABLES public tables into $SCRATCH (dropped)"
