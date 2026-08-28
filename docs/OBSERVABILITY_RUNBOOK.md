# Rasid — Observability & Incident Runbook

**Audience:** the operator on call. The HUMAN ACTION steps need no programming.
Produced by Phase 15G. Companion to `docs/BACKUP_RESTORE_RUNBOOK.md`.

Rasid runs as three processes: **web** (Vercel, Next.js), **API** (Railway, NestJS/Fastify), **worker** (Railway, Node outbox/notification loop), on a managed **Supabase** Postgres.

Every step is labelled **[AUTOMATED]** / **[HUMAN ACTION]** / **[PAID INFRA LIMIT]**.

> **Ground truth (Phase 15G §0):** monitoring is not "LIVE" until a real test event reaches Sentry. All error-tracking code is wired and DSN-gated; it stays a safe no-op until a DSN is set and the SDK installed (both external). See §Test Events.

---

## A. Where to check first

1. **Is the user-facing site up?** Open the landing page + `/login`.
2. **Is the API alive/ready?** `GET /api/v1/health` (liveness) and `GET /api/v1/ready` (DB readiness).
3. **Are errors spiking?** Sentry → the relevant project → Issues (last 1h).
4. **Is the worker failing?** Railway → worker service → Logs (look for `DEAD`, `failed unexpectedly`).
5. **Is the DB reachable?** `/ready` returning 503 → Supabase dashboard → project status.

The **request ID** (`X-Request-Id`, in every API response and log line) is the thread that ties a user report → logs → Sentry event together. Always ask for/record it.

---

## B. Sentry projects — **[HUMAN ACTION]**

Recommended: **one Sentry organisation, three projects** so web/api/worker issues are separable:

- `rasid-web` (platform: Next.js)
- `rasid-api` (platform: Node)
- `rasid-worker` (platform: Node)

(A smaller setup — one project, distinguished by the `service` tag we already set — also works; three projects give cleaner alerting.)

To create them (dashboard): New Project → pick platform → copy the **DSN**. Then set the env vars in §Environment Variables. The API/worker share one Node SDK; the web uses `@sentry/nextjs`.

---

## C. Railway logs — **[HUMAN ACTION]**

Railway → the API or worker service → **Deployments → Logs**. Logs are **structured JSON** (pino) with `time`, `level`, `name` (service), `requestId`/`jobId`, `msg`, and a safe error summary. Filter by `requestId` to follow one request; by `"level":50` for errors; by `DEAD` for terminal outbox events.

## D. Vercel logs — **[HUMAN ACTION]**

Vercel → the web project → **Deployments → Functions / Logs** for server-side (RSC/route) errors; client errors surface in Sentry `rasid-web` (via the `global-error` boundary and the client tracker).

## E. Supabase status / logs — **[HUMAN ACTION]**

Supabase dashboard → **Logs** (Postgres, API, Auth) and **Reports**. For connectivity/perf: **Database → Roles** (watch the `app_runtime` 28-connection ceiling) and **Database → Backups** (see the backup/restore runbook).

---

## F. `/health` vs `/ready` interpretation

| Endpoint | Means | If failing |
|---|---|---|
| `GET /api/v1/health` | process is alive & can answer HTTP (no dependencies touched) | the API process/container is down → Railway restart / check deploy |
| `GET /api/v1/ready` | the API can reach Postgres (bounded 2s `SELECT 1`); **503** when it can't | DB unreachable or pool exhausted → check Supabase + `app_runtime` connections; do NOT restart blindly |

`/health` should essentially always be 200 while the process runs. A **200 /health but 503 /ready** = the app is up but the database is unreachable — a **DB incident** (§J), not an app crash.

---

## G. Error triage

1. Open the Sentry issue → read title, `service` tag, `requestId`, `route`, `method`, `environment`.
2. Correlate with Railway/Vercel logs using the `requestId`.
3. **Only genuine server faults are here by design:** the API forwards to Sentry **only** unexpected errors + explicit 5xx. Expected 4xx (400/401/403/404, the 409 version conflict, 429 rate-limit) are **never** reported — so any Sentry API issue is real.
4. Decide severity (§L) and act.

## H. Request ID usage

Every API response carries `X-Request-Id` (inbound `X-Request-Id` is reused if present, else `req_<uuid>` is generated). It appears in the error-contract body (`{ "error": {...}, "requestId": "req_..." }`), in every log line, and as a Sentry tag/context. Ask the reporting user for it, or read it from the failed response, then search logs + Sentry by it.

## I. Worker failure triage

- `... failed unexpectedly — will retry next interval` → transient; the loop backs off and retries. Watch for repetition.
- `Outbox event(s) exhausted retries and are now DEAD` → **terminal**; a Sentry event is raised. Inspect `SELECT * FROM outbox_events WHERE status='DEAD'`, fix the root cause, then replay via `replayDeadOutboxEvent`.
- Worker won't start / `FATAL: WORKER_DATABASE_URL ...` → the dedicated `app_worker` connection is missing/invalid (see the migrations README).

## J. DB incident escalation

`/ready` 503 or DB errors: check Supabase status → check `app_runtime` connection count (28 ceiling) → check for a runaway query. If data is lost/corrupted, **switch to `docs/BACKUP_RESTORE_RUNBOOK.md`** (§K below).

## K. When to trigger the backup/restore runbook

Trigger **`docs/BACKUP_RESTORE_RUNBOOK.md`** when data is **lost or corrupted** (missing rows, wrong finance totals, a bad migration/deploy mutated data, or a security incident tampered with data). A plain outage with data intact is a restart/scaling problem, not a restore.

---

## L. Severity levels (V1 alert policy)

| Sev | Examples | Response |
|---|---|---|
| **P1** | `/ready` down several minutes · widespread 5xx spike · auth system unavailable · DB connectivity loss | page immediately; consider read-only mode; escalate |
| **P2** | worker retries exhausted (`DEAD`) · a route erroring repeatedly · elevated error rate · sustained high API latency | investigate within the hour |
| **P3** | isolated non-critical error | triage in normal work |

Keep it lightweight — no enterprise on-call bureaucracy. Alert on **repeated/confirmed** failure, not a single blip.

## M. Secrets / PII handling

- **Never** paste DSNs, Supabase keys, DB passwords, JWTs, or `.env` contents into git, tickets, or chat.
- Sentry events are scrubbed at source (`beforeSend`): Authorization/Cookie/token/password/api-key/webhook-secret keys are redacted, phone numbers masked to last-4, and **request bodies/cookies/headers are dropped wholesale** (only method + query-stripped URL survive). Logs use the same redactor. If you ever see raw PII/secret in Sentry, treat it as an incident and report it.

---

## Environment Variables (matrix)

Existing repo naming is used. **Never commit secrets** — set these in each platform's dashboard.

| Variable | Service | Staging | Prod | Required? | Secret? | Purpose |
|---|---|---|---|---|---|---|
| `SENTRY_DSN` | API, worker | set on Railway | set on Railway | for error tracking | **yes** | Node Sentry endpoint (unset → safe no-op) |
| `NEXT_PUBLIC_SENTRY_DSN` | web | set on Vercel | set on Vercel | for browser errors | yes (public DSN, low-sensitivity) | client Sentry endpoint |
| `SENTRY_ENVIRONMENT` / `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | all | `staging` | `production` | recommended | no | separates staging vs prod issues |
| `SENTRY_RELEASE` / `NEXT_PUBLIC_SENTRY_RELEASE` | all | commit SHA | commit SHA | recommended | no | ties errors to a deploy (Railway/Vercel expose the SHA) |
| `SENTRY_TRACES_SAMPLE_RATE` / `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | all | e.g. `0.2` | e.g. `0.05` | optional | no | perf sampling (default **0** = off) |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | web build | CI/Vercel | CI/Vercel | only for source-map upload | **yes** (auth token) | uploads source maps at build (`@sentry/nextjs`) |
| `LOG_LEVEL` | API, worker | `info` | `info` | optional | no | pino level |
| `OBSERVABILITY_DEBUG` | API, worker | `1` to debug | unset | optional | no | prints one-line tracker-status debug |

---

## Source maps — **[HUMAN ACTION]**

Production browser stack traces resolve to real source lines only when source maps are uploaded to Sentry at build. With `@sentry/nextjs` installed, wrap `next.config` with `withSentryConfig` and set `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` (secret) in the Vercel build env. Do **not** serve public `.map` files — Sentry hosts them privately. Until then, prod client errors are captured but minified.

---

## Uptime monitoring — **[HUMAN ACTION]** (no provider connected yet)

No uptime provider is wired. Recommended (free tiers suffice): **Better Stack** or **UptimeRobot**.

Monitor, at **1–5 min** intervals, with **confirmation/retry** (don't alert on a single blip):

| Check | URL | Expect |
|---|---|---|
| Web landing | `https://<prod-web-domain>/` | 200 |
| API liveness | `https://<prod-api-domain>/api/v1/health` | 200 JSON `{status:"ok"}` |
| API readiness | `https://<prod-api-domain>/api/v1/ready` | 200; **alert on 503** (DB down) |

Alert on repeated failure / timeout / unexpected status → P1 for `/ready` or landing, P2 for a single flaky check. Test alerting with the provider's built-in "test alert" or a disposable always-failing monitor — **never** by breaking production.

---

## Performance sampling / cost — **[defaults]**

- Tracing **off by default** (`*_TRACES_SAMPLE_RATE` default 0). If enabled: **staging higher** (~0.2), **production low** (~0.05).
- **Session Replay: OFF** (not enabled) unless explicitly justified and scrubbed.
- Keep breadcrumbs free of sensitive content (the `beforeSend` scrub still applies).
- Goal: catch server faults + failed jobs cheaply, not full APM.

---

## Test Events (proof) — **[HUMAN ACTION to deliver]**

Wiring is complete and unit-tested; **delivery needs a real DSN + SDK** (external).

- **API / worker [AUTOMATED once DSN set]:**
  ```bash
  pnpm --filter @academic-precision/api add @sentry/node          # + worker
  pnpm --filter @academic-precision/observability build
  SENTRY_DSN=<dsn> SENTRY_ENVIRONMENT=staging \
    node packages/observability/scripts/send-test-event.mjs api   # then: ... worker
  ```
  Confirm the event appears in Sentry; record its event ID.
- **Web [HUMAN ACTION]:** `pnpm --filter @academic-precision/web add @sentry/nextjs`, set `NEXT_PUBLIC_SENTRY_DSN` in a **staging** Vercel deploy, then trigger the `global-error` boundary once (a deliberate throw in a staging-only branch) and confirm the event in `rasid-web`. Do **not** ship a public debug route.

---

## Production variables setup checklist — **[HUMAN ACTION]**

**Vercel (web, Production):** add `NEXT_PUBLIC_SENTRY_DSN` (from `rasid-web`), `NEXT_PUBLIC_SENTRY_ENVIRONMENT=production`, `NEXT_PUBLIC_SENTRY_RELEASE`=commit SHA; for source maps also `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` (secret). Redeploy required.

**Railway (API, Production):** add `SENTRY_DSN` (from `rasid-api`, secret), `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE`; redeploy.

**Railway (worker, Production):** add `SENTRY_DSN` (from `rasid-worker`, secret), `SENTRY_ENVIRONMENT=production`, `SENTRY_RELEASE`; redeploy.

Obtain each DSN from the Sentry project's Settings → Client Keys. All DSNs/tokens are **secret** (the public browser DSN is low-sensitivity but still not committed). A redeploy is required for the runtimes to pick up new env.
