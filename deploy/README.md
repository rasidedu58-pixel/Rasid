# Rasid — self-hosted deployment assets

Target: a single Ubuntu 24.04 VPS that **already runs an unrelated production
project**. Everything here is additive and namespaced to `rasid`; no shared
config and no neighbouring file is ever modified.

## The one idea that shapes all of this

**Builds happen off the server; the server only runs artifacts.**

The host has 1.9 GB of RAM and 2 cores, shared with a live product. `next build`
peaks near 1.5–2 GB. Building there would thrash swap and could degrade the
neighbour. So the server never needs `pnpm`, a workspace install, or a
toolchain — only `node`, which is already installed (v20.20.2).

## Reserved resources (from a live audit, not assumption)

| Resource | Value | Why not the default |
|---|---|---|
| API port | `7100` | the code default `3000` is **already taken** by the neighbour's PostgREST |
| Web port | `7110` | `9000`/`9001` taken |
| GoTrue port | `7120` | `9998`/`9999` taken |
| Database | `rasid` | own database; roles `app_runtime`, `app_platform_admin`, `app_worker`, `rasid_auth` |
| Role limits | 14 / 4 / 4 / 7 | cluster `max_connections` is **50 shared** — `0073` for the three app roles, `0074` for `rasid_auth` (GoTrue) |
| Backup | 02:30 UTC | neighbour dumps at 03:00, cleans ~03:31 |

## Layout on the server

```
/opt/rasid/api/        API artifact      (pnpm deploy output: dist/ + real node_modules)
/opt/rasid/web/        Web artifact      (Next standalone; entry apps/web/server.js)
/opt/rasid/gotrue/     auth binary
/opt/rasid/bin/        backup-db.sh, restore-test.sh
/etc/rasid/*.env       secrets           (640 root:rasid — NOT in git, NOT in dumps)
/var/lib/rasid/        writable state    (the only path services may write)
/var/backups/rasid/    dumps             (700)
/etc/caddy/conf.d/rasid.caddy            the ONLY Caddy change
/etc/cron.d/rasid                        backup + monthly restore test
```

## Routing: one origin, no rewriting

```
/auth/v1/*  -> 127.0.0.1:7120   GoTrue
/api/v1/*   -> 127.0.0.1:7100   API   (owns the prefix itself)
/*          -> 127.0.0.1:7110   Web
```

Each upstream already owns its prefix, so Caddy passes paths through untouched.
That alignment is what lets the existing token verifier work with no code
change: it derives both the JWKS URL and the issuer from one base origin.

## Deploy

```bash
cp deploy/env/web.build.env.example deploy/env/web.build.env   # fill it in
deploy/scripts/build-artifacts.sh deploy/env/web.build.env
deploy/scripts/ship.sh root@<host>
```

`ship.sh` syncs only `/opt/rasid/{api,web}`, fixes ownership, restarts the two
units, and checks health on loopback.

## Three traps worth remembering

**0. A mailed auth link must land on GoTrue, not on the app.**
`GOTRUE_MAILER_URLPATHS_*` are GoTrue's own paths (`/auth/v1/verify`), not app
routes. Pointing them at an app page skips the token exchange entirely, so
signup confirmation and password recovery fail while looking configured. The
app route is supplied per request as `redirect_to` by the client — the web app
has no callback page at all, and `forgot-password` passes `/reset-password`.



**1. `NEXT_PUBLIC_*` is compiled in, not read at runtime.** Setting one in
`/etc/rasid/web.env` does nothing. Changing a public origin requires a rebuild
and reship. `turbo.json` now lists these in `build.env` so the build cache
cannot hand back an artifact compiled against a different origin.

**2. The public origin IS the token issuer.** Moving from the temporary
`sslip.io` host to a real domain invalidates every live session. It must change
together: `SUPABASE_URL` (api.env), `GOTRUE_API_EXTERNAL_URL` /
`GOTRUE_SITE_URL` / `GOTRUE_URI_ALLOW_LIST` / `GOTRUE_JWT_ISSUER`
(gotrue.env), the site address in `rasid.caddy`, and a web rebuild.

## Known gap, stated plainly

Dumps live on the same disk as the database, and `/etc/rasid/*.env` (role
passwords and the GoTrue signing key) is in neither git nor the dumps. Both
must be copied off-server. The host's own runbook names this same gap.

Role connection caps protect the neighbour from us; they cannot protect us from
the neighbour, whose roles are uncapped. That is another product's config and is
deliberately left alone — a monitored acceptance, not an oversight.

Dumps keep ACLs and ownership (`pg_dump` with neither `--no-acl` nor
`--no-owner`): 38 migrations issue GRANTs, so a dump without them restores a
schema the app roles cannot use. Roles are cluster-global and therefore dumped
separately to `roles-<date>.sql`, which contains password hashes and belongs in
the same off-server copy as `/etc/rasid/*.env`. The monthly restore test asserts
`app_runtime`'s grants on `public.students` and a floor on RLS-enabled tables,
not just a table count — a table count passes a dump that cannot serve traffic.
