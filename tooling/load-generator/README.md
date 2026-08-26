# Rasid Load Generator (TEMPORARY — Phase 15C)

An in-region HTTP load generator for the **staging** API only, so the
concurrency ceiling can be measured without a remote client's network being
the bottleneck. Zero npm dependencies (Node built-ins only).

**Delete this folder and the Railway `load-generator` service after the
capacity test.**

## Safety
- **Staging only** — refuses to start if any target URL contains a known
  production marker.
- **Idle by default** — does nothing unless `LOADTEST_ENABLED=true`, so a
  deploy never starts a test on its own.
- **Runs once** — when enabled it runs the ladder a single time, logs JSON
  results, then idles (never exits → Railway won't restart-loop it).
- No production credentials.

## Railway settings
- **Root Directory:** `tooling/load-generator`
- **Build Command:** *(leave empty — nothing to build/install)*
- **Start Command:** `node run.mjs`

## Environment variables
| Var | Required | Example / note |
|---|---|---|
| `STAGING_API_URL` | yes | `https://academic-precisionapi-staging.up.railway.app` |
| `STAGING_SUPABASE_URL` | yes | `https://lcosppsfikausgvoyxuh.supabase.co` |
| `STAGING_SUPABASE_ANON_KEY` | yes | staging project anon key (NOT service_role) |
| `LOADTEST_EMAIL` | yes | staging QA user email |
| `LOADTEST_PASSWORD` | yes | staging QA user password |
| `LOADTEST_WORKSPACE_ID` | yes | the QA workspace id to target |
| `LOADTEST_ENABLED` | to run | `true` to actually run; unset/anything else = idle |
| `LOADTEST_STAGES` | no | default `25,50,100,150,200` |
| `LOADTEST_REQUESTS_PER_CONC` | no | default `8` (requests = conc × this) |
| `LOADTEST_PATHS` | no | default staging teacher-read mix |
| `LOADTEST_KEEPALIVE` | no | `1` to reuse connections (pins to one replica); default off so the LB distributes |

## How to run a measurement
1. Deploy with `LOADTEST_ENABLED` unset → confirms it builds and idles.
2. Set `LOADTEST_ENABLED=true` and restart the service.
3. Read the ladder JSON in the Railway logs (`STAGE {...}` per level, then
   `LADDER COMPLETE [...]`).
4. Set `LOADTEST_ENABLED=false` (or delete the service) when done.
