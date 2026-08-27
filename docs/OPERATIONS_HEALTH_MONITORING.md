# Operations — Health, Readiness & Monitoring

Phase 15D.1. This documents the endpoints an external uptime/monitoring
service should probe and how error tracking is wired. Creating an external
monitor account and providing a Sentry DSN remain **HUMAN ACTION**; the code
and endpoints below are in place.

## Health & readiness endpoints

| Endpoint | Purpose | Success | On failure | Touches DB? |
|---|---|---|---|---|
| `GET /api/v1/health` | **Liveness** — the process is up and answering HTTP | `200 {"status":"ok"}` | (process down → no response) | No |
| `GET /api/v1/ready` | **Readiness** — the process can serve traffic (its Postgres pool can reach the DB) | `200 {"status":"ok"}` | `503 {"status":"unavailable","dependency":"database"}` | Yes — bounded `SELECT 1` (2s timeout) |

- **Liveness** must never fail just because a downstream is briefly down — use
  it to decide "restart this process?".
- **Readiness** gates load-balancer routing — a pod that returns 503 here
  cannot reach Postgres and should be pulled from rotation until it recovers.
  The check is a cheap `SELECT 1` with no tenant context, no business query,
  and no secrets in the response.

## Recommended uptime-probe configuration (HUMAN ACTION)

Configure an external uptime monitor (e.g. Better Uptime, UptimeRobot,
Pingdom, or the hosting platform's built-in health check) as:

| Setting | Recommended |
|---|---|
| URL (liveness) | `https://<api-host>/api/v1/health` |
| URL (readiness / LB probe) | `https://<api-host>/api/v1/ready` |
| Method | `GET` |
| Success codes | `200` |
| Interval | 30–60s |
| Request timeout | 5s (the readiness DB ping self-caps at 2s) |
| Alert after | 2–3 consecutive failures |
| Region | Prefer a probe close to the API region (eu-west-1) |

The **worker** process has no HTTP server (a sequential polling loop), so it
cannot be HTTP-probed; rely on the platform's process-crash restart and on
error-tracking alerts (below). Operators can also alert on the log line
`"Outbox event(s) exhausted retries and are now DEAD"`.

## Error tracking (Sentry) — CODE READY, DSN is HUMAN ACTION

Error capture is wired in code and is a **no-op until a DSN is provided**
(nothing is sent, no dependency required). To activate:

1. Install the SDK packages (operator, once):
   ```bash
   pnpm add @sentry/node -F @academic-precision/api -F @academic-precision/worker
   pnpm add @sentry/nextjs -F @academic-precision/web
   ```
2. Set env vars (server = API + worker; web = browser):

   | Variable | Where | Notes |
   |---|---|---|
   | `SENTRY_DSN` | API, worker | enables server capture |
   | `NEXT_PUBLIC_SENTRY_DSN` | web | enables browser capture |
   | `SENTRY_ENVIRONMENT` | all | e.g. `staging` / `production` (falls back to `NODE_ENV`) |
   | `SENTRY_TRACES_SAMPLE_RATE` | server | default `0` (errors only) |
   | `NEXT_PUBLIC_SENTRY_*` | web | mirror of the above for the browser |

PII is scrubbed before send (a `beforeSend` hook runs every event through the
same redaction used for logs, and request bodies/cookies/headers are dropped);
correlation ids (requestId/userId/workspaceId) are attached as tags. See
`packages/observability/SENTRY.md` for details.
