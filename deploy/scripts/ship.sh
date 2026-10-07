#!/usr/bin/env bash
# Ship the built artifacts to the server and restart the two Node services.
#
# Touches ONLY /opt/rasid/api and /opt/rasid/web. It never writes /etc/rasid
# (secrets), /var/lib/rasid (state), /var/backups/rasid, the neighbouring
# project's files, or any shared config.
#
# Usage: deploy/scripts/ship.sh root@204.44.93.211
set -euo pipefail

TARGET="${1:?usage: ship.sh <user@host>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$REPO_ROOT/deploy/out"

[ -f "$OUT/api/dist/main.js" ]      || { echo "FATAL: no api artifact — run build-artifacts.sh first" >&2; exit 1; }
[ -f "$OUT/web/apps/web/server.js" ] || { echo "FATAL: no web artifact — run build-artifacts.sh first" >&2; exit 1; }

echo "==> pre-flight: confirm the target is provisioned and is the right host"
ssh "$TARGET" 'set -e
  for p in /opt/rasid /etc/rasid/api.env /etc/rasid/web.env; do
    [ -e "$p" ] || { echo "FATAL: $p missing — provisioning incomplete"; exit 1; }
  done
  id rasid >/dev/null 2>&1 || { echo "FATAL: system user rasid does not exist"; exit 1; }
  echo "    ok: $(hostname)"'

# --delete keeps the remote tree identical to the artifact: a file removed from
# the build must not linger and get served. Safe because these two directories
# hold nothing but disposable build output.
echo "==> syncing api"
rsync -az --delete "$OUT/api/"  "$TARGET:/opt/rasid/api/"
echo "==> syncing web"
rsync -az --delete "$OUT/web/"  "$TARGET:/opt/rasid/web/"

# The config drop is reference material the server installs FROM; syncing it
# changes nothing live. install-config.sh is never run automatically — it
# rewrites units and the Caddy fragment, which is a deliberate act.
if [ -d "$OUT/config" ]; then
  echo "==> syncing config reference (installs nothing)"
  rsync -az --delete "$OUT/config/" "$TARGET:/opt/rasid/config/"
fi

echo "==> fixing ownership and restarting"
ssh "$TARGET" 'set -e
  chown -R rasid:rasid /opt/rasid/api /opt/rasid/web
  systemctl restart rasid-api
  systemctl restart rasid-web
  sleep 3
  systemctl is-active rasid-api rasid-web'

# /ready, NOT /health. `/health` is pure liveness: it answers "the process
# accepts HTTP" without touching a dependency, so a service started with a
# wrong or unreachable DATABASE_URL reports healthy and the deploy looks
# successful — the API boots fully with no database at all. `/ready` runs
# pingDatabase() and returns 503 when the pool cannot reach Postgres, which is
# the question a deploy actually needs answered.
echo "==> post-deploy readiness (loopback, through nothing)"
ssh "$TARGET" 'set -e
  curl -fsS -m 15 http://127.0.0.1:7100/api/v1/ready \
    || { echo "FATAL: API is up but NOT ready — it cannot reach the database."; \
         echo "       Check DATABASE_URL in /etc/rasid/api.env and: journalctl -u rasid-api -n 50"; \
         exit 1; }
  echo
  curl -fsS -m 15 -o /dev/null -w "web: HTTP %{http_code}\n" http://127.0.0.1:7110/'
echo "==> done"
