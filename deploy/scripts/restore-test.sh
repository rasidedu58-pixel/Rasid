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

# Counting tables is NOT enough, and the previous version of this script stopped
# there. A dump taken with --no-acl restores every table and still leaves the
# application roles with no privileges at all — so the table count passes while
# the restored database is unusable. Assert the privileges directly.
#
# `students` is a core tenant table that app_runtime must be able to read and
# write; if its grants came back, the ACLs survived the round trip.
for PRIV in SELECT INSERT UPDATE; do
  OK=$(sudo -u postgres psql -At --dbname "$SCRATCH" \
    -c "SELECT has_table_privilege('app_runtime','public.students','$PRIV');")
  if [ "$OK" != "t" ]; then
    echo "rasid-restore-test: FAIL app_runtime lacks $PRIV on public.students after restore" >&2
    echo "  the dump carries no ACLs — a restore from it would not serve traffic." >&2
    exit 1
  fi
done

# RLS is the tenant-isolation boundary; a restore that drops it would silently
# expose every workspace's rows to every other workspace.
RLS=$(sudo -u postgres psql -At --dbname "$SCRATCH" \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity;")
if [ "$RLS" -lt 10 ]; then
  echo "rasid-restore-test: FAIL only $RLS public tables have RLS enabled after restore" >&2
  exit 1
fi

echo "rasid-restore-test: ok $NEWEST restored $TABLES public tables, $RLS RLS-enabled, app_runtime grants intact (dropped $SCRATCH)"
