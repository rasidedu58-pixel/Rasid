#!/usr/bin/env bash
# Install the self-hosted Supabase Auth (GoTrue) binary. Run ON THE SERVER as root.
#
# It downloads, verifies and places the binary. It does NOT start the service,
# write any config, or touch the database — those are separate, reviewable
# steps.
#
# The version is PINNED. GoTrue's env var names and its asymmetric-key support
# have drifted across releases, so "latest" is a liability: an unattended
# upgrade could change the contract the API's token verifier depends on.
#
# Usage: install-gotrue.sh [version]      e.g. install-gotrue.sh v2.197.0
set -euo pipefail

VERSION="${1:-v2.197.0}"
DEST=/opt/rasid/gotrue
REPO=supabase/auth

[ "$(id -u)" -eq 0 ] || { echo "FATAL: run as root" >&2; exit 1; }
[ -d /opt/rasid ] || { echo "FATAL: /opt/rasid missing — run provisioning first" >&2; exit 1; }

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ASSET="auth-${VERSION}-amd64.tar.xz" ;;
  aarch64|arm64) ASSET="auth-${VERSION}-arm64.tar.xz" ;;
  *) echo "FATAL: unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

# The amd64/arm64 assets are .tar.xz, so xz is a hard requirement.
command -v xz >/dev/null 2>&1 || { echo "FATAL: 'xz' not found. Install it first: apt-get install -y xz-utils" >&2; exit 1; }

URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> downloading $ASSET"
curl -fsSL --retry 3 -o "$TMP/$ASSET" "$URL"

# No checksum file is published alongside these assets, so we cannot verify
# against an upstream digest. Record what we actually got: pinning the version
# AND logging this digest is what makes a future re-download comparable.
echo "==> sha256 of the downloaded asset (record this):"
sha256sum "$TMP/$ASSET"

echo "==> extracting"
tar -xJf "$TMP/$ASSET" -C "$TMP"

# The archive layout is not guaranteed stable across releases, so locate the
# executable rather than assuming a path.
BIN="$(find "$TMP" -type f \( -name auth -o -name gotrue \) -perm -u+x | head -1)"
[ -n "$BIN" ] || { echo "FATAL: no 'auth' or 'gotrue' executable found inside the archive" >&2; find "$TMP" -maxdepth 3 -type f | head -20 >&2; exit 1; }

echo "==> verifying it is a native binary for this machine"
file "$BIN"
case "$(file -b "$BIN")" in
  *x86-64*|*aarch64*|*ARM\ aarch64*) ;;
  *) echo "FATAL: downloaded file is not a native executable for $ARCH" >&2; exit 1 ;;
esac

mkdir -p "$DEST"
install -m 755 -o root -g root "$BIN" "$DEST/auth"

# Older releases read their SQL migrations from disk; newer ones embed them.
# Copy the directory when present so either behaviour works.
MIGDIR="$(find "$TMP" -type d -name migrations | head -1)"
if [ -n "$MIGDIR" ]; then
  rm -rf "$DEST/migrations"
  cp -r "$MIGDIR" "$DEST/migrations"
  echo "==> copied bundled migrations to $DEST/migrations"
else
  echo "==> no migrations directory in the archive (this release embeds them)"
fi

chown -R root:root "$DEST"
echo
echo "==> installed: $DEST/auth  (pinned $VERSION)"
"$DEST/auth" --version 2>/dev/null || echo "    (this build does not implement --version; the binary check above is the proof)"
echo
echo "NOT started. Next: write /etc/rasid/gotrue.env, then enable the unit."
