# Rasid Load-Test Harness (STAGING ONLY)

A zero-dependency Node harness that drives a realistic mixed **read** workload
(and optional isolated **writes**) against the **staging** Rasid API, and writes
JSON + CSV latency/throughput summaries.

It is self-contained: only Node built-ins (`node:https`, global `fetch`,
`performance`). Nothing to install, nothing to build. Node 18+ (for global
`fetch`).

> **Run it from an in-region host** (a Railway one-off / shell in the same
> region as the staging API) so latency reflects the server, not your laptop's
> transatlantic hop. See "In-region run" below.

---

## Safety guarantees

- **Staging only.** The runner refuses to start unless `LOAD_TEST_API_URL`'s
  host contains `staging` or `localhost`. A deliberate non-production override
  exists (`LOAD_TEST_ALLOW_UNSAFE=1`) but must be set explicitly and never for
  production. No production URL is hardcoded anywhere.
- **Credentials from env only.** Nothing is committed; see `.env.example`.
- **Writes OFF by default.** Writes run only with `--writes=on` *and* an
  explicit `LOAD_TEST_WRITE_SESSION_ID` pointing at an **isolated** fixture
  session. Shared read fixtures are never mutated.
- **Graceful stop.** `Ctrl+C` (SIGINT) drains in-flight requests, writes the
  partial results, and exits. A second `Ctrl+C` forces exit.

---

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `LOAD_TEST_API_URL` | yes | Staging API origin, e.g. `https://academic-precisionapi-staging.up.railway.app`. Host must contain `staging`/`localhost` (or set the override). The harness appends `/api/v1`. |
| `LOAD_TEST_SUPABASE_URL` | yes | Staging Supabase project URL, e.g. `https://<ref>.supabase.co`. |
| `LOAD_TEST_SUPABASE_KEY` | yes | Staging **anon** key (not service_role). |
| `LOAD_TEST_EMAIL` | yes | QA user email. |
| `LOAD_TEST_PASSWORD` | yes | QA user password. |
| `LOAD_TEST_WORKSPACE_ID` | yes | Workspace id sent as `X-Workspace-Id` on every call. |
| `LOAD_TEST_WRITE_SESSION_ID` | only for writes | Isolated fixture session id, safe to mutate. Required when `--writes=on`. |
| `LOAD_TEST_ALLOW_UNSAFE` | no | Set to `1` to allow a non-staging/non-localhost host. Never for production. |

## CLI flags

| Flag | Default | Meaning |
|---|---|---|
| `--ladder` | off | Run the concurrency ladder (`25,50,100,150,200` by default). |
| `--stages 25,50,100` | `25,50,100,150,200` | Override the ladder stages. |
| `--vus N` | `50` | Single concurrency level (ignored when `--ladder` is set). |
| `--duration 30s` | `30s` | Wall time per profile. Accepts `ms`, `s`, `m`, `h`, or a bare number (= seconds). |
| `--think-ms 100` | `100` | Per-VU pause between requests (ms). |
| `--writes on` | `off` | Enable isolated writes (needs `LOAD_TEST_WRITE_SESSION_ID`). |
| `--keep-alive on` | `off` | Reuse TCP connections. Default off so Railway's LB spreads load across replicas. |
| `--timeout-ms 30000` | `30000` | Per-request timeout. |

---

## Workload

**Reads** (weighted; dashboard/notifications/students heavier):

- `/action-center`, `/notifications`, `/students?limit=30` (weight 5)
- `/me/workspaces/{workspaceId}/context` (weight 4)
- `/groups`, `/attention-cases?limit=50`, `/sessions?limit=50` (weight 3)
- `/me`, `/finance/summary`, `/finance/collection-queue` (weight 2)

**Writes** (opt-in, ~1 in 5 ops when enabled): alternates
`PUT /sessions/{id}/attendance` and `PUT /sessions/{id}/homework` against the
fixture session, sending the full roster with `sessionVersion` (optimistic
locking; the runner keeps the version in sync from each response).

Auth: one Supabase password-grant token, reused across all requests, and
automatically re-minted once on any `401`.

---

## Run locally (against staging)

```bash
cd tooling/load-test
cp .env.example .env      # fill in staging values

# Load .env into the shell, then run. On PowerShell see the note below.
# bash / Railway shell:
set -a; . ./.env; set +a

# 1) Ladder (the headline capacity run):
node load-test.mjs --ladder --duration 30s --think-ms 100

# 2) Single level:
node load-test.mjs --vus 100 --duration 60s --think-ms 100

# 3) With isolated writes (requires LOAD_TEST_WRITE_SESSION_ID in .env):
node load-test.mjs --writes on --vus 20 --duration 20s
```

PowerShell (Windows) env loading — the harness reads only `process.env`, so set
the vars in the session first, e.g.:

```powershell
$env:LOAD_TEST_API_URL="https://academic-precisionapi-staging.up.railway.app"
$env:LOAD_TEST_SUPABASE_URL="https://<ref>.supabase.co"
$env:LOAD_TEST_SUPABASE_KEY="<anon-key>"
$env:LOAD_TEST_EMAIL="qa-user@example.com"
$env:LOAD_TEST_PASSWORD="<password>"
$env:LOAD_TEST_WORKSPACE_ID="<workspace-id>"
node load-test.mjs --ladder
```

Results land in `tooling/load-test/results/` (gitignored) as timestamped
`.json` and `.csv` files.

---

## In-region run (Railway — recommended)

To measure the server's true ceiling, run the harness from the same region as
the staging API rather than a dev laptop.

**Option A — Railway one-off service (temporary):**

1. In the staging Railway project, create a new service from this repo.
2. Set **Root Directory** to `tooling/load-test`.
3. Leave **Build Command** empty (nothing to build).
4. Set **Start Command** to, e.g.:
   `node load-test.mjs --ladder --duration 30s`
5. Add the env vars from the table above to that service (staging values).
6. Deploy, read the ladder output in the service logs, then **delete the
   service** when done. (Results files live in the container; copy them from
   the logs or a shell before deleting.)

**Option B — Railway shell (no extra service):**

```bash
# From a Railway shell attached to an in-region staging service:
cd tooling/load-test
# env vars are already present if the service has them; otherwise export them.
node load-test.mjs --ladder --duration 30s
```

Because the ladder halts early if server errors exceed 2%, a clean full ladder
means the API sustained every level.

---

## Reading the output

Each profile row reports: total requests, ok requests, error count, rps, wall
time, and p50/p90/p95/p99 latency, plus a non-200 status breakdown. The JSON
also carries a reminder that **DB-side transactions/sec must be read separately**
from the database provider's own metrics — this harness measures client-side
HTTP throughput and latency only.
