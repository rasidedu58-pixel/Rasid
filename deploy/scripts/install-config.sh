#!/usr/bin/env bash
# Install Rasid's config files onto the server. Run ON THE SERVER as root,
# from the shipped config directory:
#   /opt/rasid/config/scripts/install-config.sh
#
# WHAT IT WILL NOT DO, by design:
#  * never overwrite an existing /etc/rasid/*.env — those hold live secrets.
#    Templates are copied only when the file is absent.
#  * never edit /etc/caddy/Caddyfile, another project's conf.d fragment, any
#    shared cron file, or any unit that is not rasid-*.
#  * never enable or start a service. Installing config and deciding to run it
#    are separate decisions.
#
# It is idempotent: re-running it re-installs units/caddy/cron/bin and leaves
# secrets alone.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "FATAL: run as root" >&2; exit 1; }

for d in systemd caddy cron env; do
  [ -d "$SRC/$d" ] || { echo "FATAL: missing $SRC/$d — is this the shipped config directory?" >&2; exit 1; }
done
id rasid >/dev/null 2>&1 || { echo "FATAL: system user 'rasid' does not exist — run the provisioning step first" >&2; exit 1; }

echo "==> directories"
install -d -m 755 -o rasid -g rasid /opt/rasid/api /opt/rasid/web /opt/rasid/gotrue /var/lib/rasid
install -d -m 755 -o root  -g root  /opt/rasid/bin
# Secrets: readable by the service user, writable only by root.
install -d -m 750 -o root  -g rasid /etc/rasid
install -d -m 700 -o root  -g root  /var/backups/rasid

echo "==> maintenance scripts"
install -m 750 -o root -g root "$SRC/scripts/backup-db.sh"     /opt/rasid/bin/backup-db.sh
install -m 750 -o root -g root "$SRC/scripts/restore-test.sh"  /opt/rasid/bin/restore-test.sh
install -m 750 -o root -g root "$SRC/scripts/generate-auth-keys.mjs" /opt/rasid/bin/generate-auth-keys.mjs

echo "==> env templates (only where no file exists yet)"
for t in api web gotrue; do
  TARGET="/etc/rasid/$t.env"
  if [ -e "$TARGET" ]; then
    echo "    keeping existing $TARGET (contains live secrets)"
  else
    install -m 640 -o root -g rasid "$SRC/env/$t.env.example" "$TARGET"
    echo "    created $TARGET from template — FILL IN every __PLACEHOLDER__"
  fi
done

echo "==> systemd units"
for u in rasid-api rasid-web rasid-gotrue; do
  install -m 644 -o root -g root "$SRC/systemd/$u.service" "/etc/systemd/system/$u.service"
done
systemctl daemon-reload

echo "==> cron"
install -m 644 -o root -g root "$SRC/cron/rasid" /etc/cron.d/rasid

echo "==> caddy fragment"
# Caddy needs a writable log directory before it is told to log there — but if
# it already exists it is SHARED with other projects' logs. Creating it is
# ours to do; re-stating its mode or ownership is not. `install -d` would
# silently apply the mode to an existing directory, which on this host would
# loosen 750 to 755 and expose a neighbour's access logs. So: create only when
# absent, and otherwise touch nothing.
if [ -d /var/log/caddy ]; then
  echo "    /var/log/caddy exists — leaving its mode and ownership untouched (shared)"
else
  install -d -m 750 -o caddy -g caddy /var/log/caddy
  echo "    created /var/log/caddy (750 caddy:caddy)"
fi
install -m 644 -o root -g root "$SRC/caddy/rasid.caddy" /etc/caddy/conf.d/rasid.caddy

# Validate the WHOLE config — ours plus every neighbour's — before reloading.
# A reload with a broken config takes down every site on the box, so this
# ordering is the safety property, not a formality.
echo "==> validating the complete Caddy configuration"
if ! caddy validate --config /etc/caddy/Caddyfile; then
  echo "FATAL: Caddy config invalid. REMOVING our fragment and leaving the running config untouched." >&2
  rm -f /etc/caddy/conf.d/rasid.caddy
  exit 1
fi
echo "    valid — but NOT reloaded. Reload deliberately when the upstreams are up:"
echo "      systemctl reload caddy"

echo
echo "==> installed. Nothing enabled, nothing started, Caddy not reloaded."
echo "    Next: fill /etc/rasid/*.env, then enable units one at a time."
