#!/usr/bin/env bash
# Build the two shippable artifacts OFF the server.
#
# WHY OFF-SERVER: the target is a 1.9 GB box shared with an unrelated
# production product. `next build` peaks around 1.5-2 GB; running it there
# would thrash swap and could degrade a live neighbour. So the server receives
# built artifacts only and needs no pnpm, no workspace install, no toolchain.
#
# Usage:  deploy/scripts/build-artifacts.sh <path-to-web-build-env>
# Example: deploy/scripts/build-artifacts.sh deploy/env/web.build.env
#
# Output:
#   deploy/out/api/   -> becomes /opt/rasid/api   (dist/ + real node_modules)
#   deploy/out/web/   -> becomes /opt/rasid/web   (Next standalone server)
set -euo pipefail

BUILD_ENV="${1:?usage: build-artifacts.sh <path-to-web-build-env>}"
[ -f "$BUILD_ENV" ] || { echo "FATAL: build env file not found: $BUILD_ENV" >&2; exit 1; }

# ── 0. Platform gate ────────────────────────────────────────────────────────
# Next's standalone output recreates pnpm's symlink tree. Windows refuses to
# create symlinks without Developer Mode or an elevated shell, so the build
# dies at the very last step (EPERM on symlink) AFTER compiling successfully —
# a confusing failure worth naming up front. Build on Linux (CI or WSL).
case "$(uname -s 2>/dev/null || echo unknown)" in
  Linux|Darwin) ;;
  *)
    echo "FATAL: this produces a Next.js standalone artifact, which needs symlink" >&2
    echo "       support. On Windows the build compiles and then fails with" >&2
    echo "       'EPERM: operation not permitted, symlink'." >&2
    echo "" >&2
    echo "       Use one of:" >&2
    echo "         - the 'Build deploy artifacts' GitHub Actions workflow (recommended)" >&2
    echo "         - WSL" >&2
    echo "         - Windows Developer Mode, then re-run" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"
OUT="$REPO_ROOT/deploy/out"

# ── 1. Load the BUILD-TIME public env ───────────────────────────────────────
# Every NEXT_PUBLIC_* value is compiled INTO the bundle here. If one is wrong,
# the fix is a rebuild — not a server restart.
set -a
# shellcheck disable=SC1090
. "$BUILD_ENV"
set +a

# NODE_ENV is deliberately NOT exported yet — see step 2. A build env file that
# sets it itself would reintroduce the bug, so clear it here.
unset NODE_ENV

: "${NEXT_PUBLIC_API_URL:?NEXT_PUBLIC_API_URL must be set in $BUILD_ENV}"
: "${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL must be set in $BUILD_ENV}"

# Fail fast on the mistake that is hardest to notice later: the API base must
# carry the /api/v1 prefix, and the auth origin must NOT (supabase-js appends
# /auth/v1 itself).
case "$NEXT_PUBLIC_API_URL" in
  */api/v1) ;;
  *) echo "FATAL: NEXT_PUBLIC_API_URL must end with /api/v1 (got: $NEXT_PUBLIC_API_URL)" >&2; exit 1;;
esac
case "$NEXT_PUBLIC_SUPABASE_URL" in
  */auth/v1*|*/) echo "FATAL: NEXT_PUBLIC_SUPABASE_URL must be the bare origin, no path, no trailing slash (got: $NEXT_PUBLIC_SUPABASE_URL)" >&2; exit 1;;
esac

echo "==> building against"
echo "    API  : $NEXT_PUBLIC_API_URL"
echo "    AUTH : $NEXT_PUBLIC_SUPABASE_URL"

# ── 2. Install + build the whole workspace ──────────────────────────────────
# Workspace packages publish from dist/ (their package.json main points there),
# so they must be built before the API bundle is assembled.
#
# ORDER MATTERS, AND NODE_ENV MUST NOT BE SET FOR THE INSTALL. pnpm skips
# devDependencies entirely when NODE_ENV=production ("devDependencies: skipped
# because NODE_ENV is set to production"), and the build toolchain lives
# there: turbo, the TypeScript compiler, the Nest CLI. Exporting it before the
# install left no turbo on PATH and the build died with
# "turbo: command not found" on a clean checkout. It only appeared to work
# where a previous full install had already populated node_modules.
pnpm install --frozen-lockfile

# Now it is safe: next build and nest build read NODE_ENV, and turbo.json
# lists it in build.env so the cache key reflects it.
export NODE_ENV=production
pnpm build

# ── 3. API artifact: self-contained directory ───────────────────────────────
# `pnpm deploy` resolves workspace deps into a REAL, flat node_modules (not the
# symlink farm), which is what makes it safe to rsync and run with plain node.
rm -rf "$OUT/api"
mkdir -p "$OUT"
pnpm --filter @academic-precision/api deploy --prod "$OUT/api"
[ -f "$OUT/api/dist/main.js" ] || { echo "FATAL: api artifact missing dist/main.js" >&2; exit 1; }

# ── 4. Web artifact: Next standalone ────────────────────────────────────────
# Next does NOT copy public/ or .next/static into the standalone output; doing
# it by hand is a required step, not an optimisation. With
# outputFileTracingRoot at the repo root, the tree is rooted at the monorepo,
# so the server entrypoint is apps/web/server.js.
rm -rf "$OUT/web"
cp -r apps/web/.next/standalone "$OUT/web"
mkdir -p "$OUT/web/apps/web/.next"
cp -r apps/web/.next/static "$OUT/web/apps/web/.next/static"
if [ -d apps/web/public ]; then cp -r apps/web/public "$OUT/web/apps/web/public"; fi
[ -f "$OUT/web/apps/web/server.js" ] || { echo "FATAL: web artifact missing apps/web/server.js" >&2; exit 1; }

# ── 5. Config drop ──────────────────────────────────────────────────────────
# ship.sh syncs deploy/out/config only `if [ -d ]`, and install-config.sh runs
# FROM that directory on the server. Without this stage a local build shipped
# the two artifacts and silently no units, no Caddy fragment and no cron — the
# CI workflow built it but this script did not, so the two paths disagreed.
# The build/ship scripts themselves are workstation tools and are excluded.
rm -rf "$OUT/config"
mkdir -p "$OUT/config"
for d in systemd caddy cron env scripts; do
  cp -r "$REPO_ROOT/deploy/$d" "$OUT/config/$d"
done
rm -f "$OUT/config/scripts/build-artifacts.sh" "$OUT/config/scripts/ship.sh"
[ -f "$OUT/config/scripts/install-config.sh" ] || { echo "FATAL: config drop missing install-config.sh" >&2; exit 1; }

echo
echo "==> artifacts ready"
du -sh "$OUT/api" "$OUT/web" "$OUT/config"
echo "    next: deploy/scripts/ship.sh <user@host>"
