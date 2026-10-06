# Rasid — Self-Hosting Plan (Vercel + Railway + Supabase → one VPS)

**Scope:** a **clean production launch** on the VPS. There is no real data and
no real user yet, so there is no data migration, no auth-user export, no UUID
preservation problem, no write-freeze and no maintenance window. The database
is created empty and the 72 migrations build it.

**Decisions taken by the owner:** full self-hosting now, including auth via
self-hosted GoTrue, onto an **existing** Ubuntu 24.04 VPS that already runs an
unrelated production project (`shouon`) under a shared runbook.

**Standing constraints:** no command runs on the server without a read-only
check before it; no other project's files, config, database, roles or schedules
are touched; nothing is assumed about ports or paths without measuring.

---

## 1. Audit results (measured on the target, 2026-10-06)

### The host

| | |
|---|---|
| OS / kernel | Ubuntu 24.04 LTS, 6.8.0-31, x86_64, 2 vCPU |
| Memory | 1.9 GiB total, **1.2 GiB available**, 1 GiB swap already configured |
| Disk | 34 GB, 24 GB free (26 % used) |
| Load | 0.00 across 19 days of uptime |
| Firewall | UFW active, default deny incoming; 22/80/443 plus 3478 and 49160-49200/udp (the neighbour's TURN relay) |
| fail2ban | active, `sshd` jail |
| Node | **v20.20.2** — already adequate; **not upgraded** (the neighbour runs four Node services on it) |
| Tooling present | git, rsync, jq, corepack, zrok, Caddy v2.11.4 |
| Not present | nginx, apache2 (no port-80 contention), pnpm, redis, gotrue |
| SSH | **root login and password auth are both enabled** — recorded as an open item, out of scope here, and deliberately not changed |

### Ports already taken

`22, 53, 80, 443, 2019, 3000, 3001, 3478, 5432, 8088, 8089, 9000, 9001, 9998, 9999`

The API's code default is `3000`, which **is already PostgREST's** on this box.

### PostgreSQL

Cluster 16.15 (client tools 17.11), `listen_addresses = localhost`,
`max_connections = 50`, `superuser_reserved_connections = 3`,
`shared_buffers = 384MB`.

Existing databases: `postgres`, `shouon`, `shouon-staging`, `shouon_pre_restore`.
Existing login roles: `postgres`, `authenticator`, `auth_service`, `backup_reader`
— **all uncapped** (`rolconnlimit = -1`).

Measured steady state: **15 client connections** (the neighbour's PostgREST 11
across two environments, its auth role 2, admin 2).

### Caddy

The host's main `Caddyfile` states in its own comments that it belongs to no
project and must not be edited when adding one; each project drops a fragment
into `conf.d/` which is picked up by `import /etc/caddy/conf.d/*.caddy`. ACME
email is already configured globally. `caddy validate` on the current config
returns **Valid configuration**.

The neighbour serves `shouon-al-ghethaa.com`, `www` (301 only), and
`204.44.93.211.sslip.io` — which reveals both the public IP and the local
convention of using `sslip.io` as a no-DNS entry point.

### Name collisions

None. `rasid` is free as a database name, as a role prefix, under `/opt`,
`/etc`, `/var/lib`, `/var/backups`, as `conf.d/rasid.caddy`, as
`/etc/cron.d/rasid`, and as `rasid-{api,web,gotrue,worker}.service`.

---

## 2. Code compatibility (verified, not assumed)

| Question | Finding |
|---|---|
| Do migrations depend on Supabase? | **No.** Every `auth.*`/`supabase` match across all migrations is a **comment**. No `auth.uid()`, no Supabase extensions, no `storage.objects`. |
| How is row-level security scoped? | GUCs (`app.workspace_id`, `app.user_id`) via `set_config` — not JWT claims. Portable as-is. |
| Are the roles safe on a shared cluster? | Yes. `CREATE ROLE` is wrapped in a `DO` block guarded by `IF NOT EXISTS`, created `NOLOGIN` with **no password** (set out-of-band per environment). |
| PostgREST-style roles (`anon`/`authenticated`/`service_role`)? | **Not used.** Only `app_runtime`, `app_platform_admin`, `app_worker`. The host's PostgREST/auth/storage/PHP stack is irrelevant to Rasid. |
| Depth of the Supabase Auth coupling | **7 web files**, all `supabase.auth`, plus one `createClient`. No `supabase.storage`, no `supabase.from(...)`. Server side: one JWKS verifier. |
| Token verification | `jose.createRemoteJWKSet` against `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, issuer `{SUPABASE_URL}/auth/v1`. **Asymmetric only — no shared-secret path exists.** |
| Is the JWT used for authorization? | No. Identity only (ADR-008); all authorization resolves from the database. Swapping the auth provider does not touch the permission system. |
| `SUPABASE_SERVICE_ROLE_KEY` | Declared in the env schema, **never used in code.** No auth admin API to reimplement. |
| Object storage | `R2_*` declared, unused in code. Nothing to move. |
| Redis / worker | `REDIS_URL` optional; the worker is not deployed. Redis deferred. |
| Transactional email | `RESEND_API_KEY` already integrated — it serves GoTrue's SMTP. No new vendor. |

**Verdict:** the database and all three processes port cleanly. The only new
component is the auth server, and because the verifier is a standard JWKS
consumer, that is configuration rather than a rewrite.

**Staying external** (none of them Vercel/Railway/Supabase): Resend, Paddle,
Sentry, PostHog.

---

## 3. Target architecture

### Single origin, no path rewriting

```
https://rasid.204.44.93.211.sslip.io
  /auth/v1/*  ->  127.0.0.1:7120   GoTrue
  /api/v1/*   ->  127.0.0.1:7100   API    (owns the prefix itself)
  /*          ->  127.0.0.1:7110   Web
```

Each upstream already owns its prefix, so Caddy passes paths through
untouched. That alignment is what lets the existing verifier work verbatim
with `SUPABASE_URL` set to the origin, and makes browser-to-API same-origin so
CORS and cookie scope stop being failure modes.

**The temporary `sslip.io` host lets us launch and verify over real HTTPS
before owning a domain** — a label prefixed to `<ip>.sslip.io` resolves to that
IP and does not collide with the neighbour's bare name.

### Reserved resources

| Resource | Value | Why |
|---|---|---|
| API / Web / GoTrue ports | `7100` / `7110` / `7120` | verified free; a band clear of both of the neighbour's |
| Database | `rasid`, `UTF8`, `en_US.UTF-8` | matches what the code was built and tested against, so Arabic sorting is unchanged |
| App roles | `app_runtime`, `app_platform_admin`, `app_worker` | created by the migrations |
| Auth role | `rasid_auth` | owns the `auth` schema; app roles get **no** grant on it |
| Role caps | 14 / 4 / 4 (migration `0073`) | see below |
| Service user | `rasid` system user | least privilege |
| Backup | 02:30 UTC daily + monthly restore test | the neighbour dumps at 03:00 and prunes around 03:31 |

### Connection budget

```
max_connections 50 - superuser_reserved 3      = 47 usable
neighbour, measured steady state                = 15
Rasid caps (14 + 4 + 4)                         = 22   (steady demand 13)
worst case                                      = 37 of 47 -> 10 spare
```

Migration `0073` supersedes `0050`'s 36-connection reservation, which was
sized for Supabase's 60-connection single-tenant cluster. `0050` is not
edited — migrations are forward-only.

**Stated asymmetry:** these caps protect the neighbour from Rasid. They cannot
protect Rasid from the neighbour, whose roles are uncapped. Capping them would
complete the budget but is another product's configuration and is deliberately
left alone. Its usage is measured and stable; this is a monitored acceptance.

---

## 4. Auth: self-hosted GoTrue

Pinned to **v2.197.0** (`auth-v2.197.0-amd64.tar.xz`). "Latest" is a liability:
env var names and asymmetric-key support have drifted between releases, and an
unattended change would break the contract the verifier depends on.

- **Asymmetric signing is mandatory** — the verifier accepts JWKS only.
  Configured via `GOTRUE_JWT_KEYS` (a JSON array holding the EC P-256 **private**
  key plus the legacy symmetric key) and `GOTRUE_JWT_VALID_METHODS=ES256`.
  `GOTRUE_JWT_SECRET` is still required: the symmetric key lives inside
  `JWT_KEYS`, and the anon key is an HS256 JWT signed with it.
- GoTrue publishes the EC public half at `/auth/v1/.well-known/jwks.json` and
  excludes the symmetric key — exactly the path the verifier requests.
- `GOTRUE_JWT_ISSUER` **must equal the origin plus `/auth/v1` character for
  character.** A mismatch produces blanket 401s with a valid-looking token.
- Keys are generated by `deploy/scripts/generate-auth-keys.mjs` (zero
  dependencies, runs with the system node) directly on the server.
- Email via **Resend SMTP**. Server-local mail is not an option: outbound port
  25 is typically blocked and deliverability would be poor.
- It owns `auth` inside the same `rasid` database under `rasid_auth`. The app
  roles are not granted on that schema, so compromising `app_runtime` does not
  expose password hashes.
- **Token shape must be asserted with a real token** during the auth rehearsal
  (`sub`, `email`, `user_metadata.full_name`) — same software, but verified not
  assumed.

**Known upstream issue:** GoTrue has had a reported problem where its JWKS
cache does not refresh at runtime after a key rotation. Treat rotation as a
deliberate, restart-accompanied operation.

---

## 5. Build and ship

**Builds never run on the server.** It has 1.9 GiB shared with a live product
and `next build` peaks near 1.5-2 GiB.

Also: `output: "standalone"` recreates pnpm's symlink tree, which **Windows
refuses without Developer Mode** — the build compiles fully and then dies on
`EPERM` at the final step. So Linux CI is the builder.

```
GitHub Actions "Build deploy artifacts" (manual dispatch)
  -> deploy/out/api      pnpm deploy output: dist/ + real flat node_modules
  -> deploy/out/web      Next standalone; entry apps/web/server.js
  -> deploy/out/config   units, Caddy fragment, cron, env templates, scripts
```

The workflow takes the public origin as an **input** because every
`NEXT_PUBLIC_*` value is compiled into the bundle — an artifact is valid only
for the origin it was built for. `turbo.json` now lists those vars in
`build.env` so the build cache cannot hand back an artifact compiled against a
different origin. The workflow also smoke-boots the API artifact to catch an
incomplete package in CI rather than as a crash-loop on the server. It does
not deploy and holds no server credentials.

`deploy/scripts/ship.sh` then rsyncs to `/opt/rasid/{api,web,config}`, fixes
ownership, restarts the two Node units and checks health on loopback. It
touches nothing else.

---

## 6. Execution order

Read-only verification precedes every mutating step; each step stops on failure.

1. **Done — server inventory** (section 1).
2. **Done — database and directories.** `rasid` created `UTF8 / en_US.UTF-8`;
   `/opt/rasid`, `/etc/rasid`, `/var/lib/rasid`, `/var/backups/rasid` created.
3. **Done — repo preparation.** Migration `0073`, standalone output, `HOST`
   var, turbo cache keys, `deploy/` assets, CI workflow.
4. **Service user and auth role** — `rasid` system user; `rasid_auth` with
   `CREATE` on the database.
5. **Migrations** — run **from a workstation over an SSH tunnel** with
   `MIGRATION_DATABASE_URL`. The server needs no pnpm and no toolchain, and no
   request handler ever holds migration rights.
6. **Role passwords** — `ALTER ROLE ... WITH LOGIN PASSWORD`, generated on the
   server, written straight into `/etc/rasid/api.env`.
7. **GoTrue** — install the pinned binary, generate keys, let it migrate the
   `auth` schema, confirm the JWKS endpoint serves the EC public key.
8. **Config install** — units, Caddy fragment, cron (`install-config.sh`
   validates the complete Caddy config before anything is reloaded).
9. **Build and ship** — CI artifact, then `ship.sh`.
10. **Caddy reload** — only once the three upstreams answer on loopback.
11. **Auth rehearsal** — signup, confirmation email, login, and a real token
    accepted by the API with permissions resolved from the database. **Gate.**
12. **Bootstrap** — first owner account, then the first `platform_admins` row
    (deliberately an out-of-band operation; migration `0048` creates the table
    but grants nobody).
13. **Backups** — install cron, run one dump by hand, run one restore test.
14. **Smoke test** — login, dashboard, a write, platform admin, leads page.

---

## 7. Open items

1. **Domain.** Launch runs on `sslip.io`. Switching later invalidates every
   session and must change together: the site address in `rasid.caddy`,
   `SUPABASE_URL`, `GOTRUE_API_EXTERNAL_URL` / `GOTRUE_SITE_URL` /
   `GOTRUE_URI_ALLOW_LIST` / `GOTRUE_JWT_ISSUER`, **and a web rebuild**.
   Harmless now; expensive once there are users.
2. **Resend sender domain** must be verified before confirmation and recovery
   email will deliver.
3. **Off-server copies.** Dumps live on the same disk as the database, and
   `/etc/rasid/*.env` (role passwords, the GoTrue signing key) is in neither
   git nor the dumps. The host's own runbook names this same gap.
4. **SSH hardening** (root and password login) — recorded, out of scope, and a
   change that must be made with a verified second session open.
5. **Single unmanaged host.** No autoscale; patching, monitoring and backup
   verification are now ours.

## 8. Out of scope

PostgREST, the host's bundled auth/storage services, PHP-fpm, coturn — Rasid
uses none of them. Redis and the worker, until the worker is deployed. Object
storage. zrok (optional; the domain path does not need it). Replacing Resend,
Paddle, Sentry or PostHog.
