# migrations

Generated Drizzle SQL migrations live here (`pnpm --filter @academic-precision/database db:generate`).

**Migrations are the only production schema-change path.** No script in this
package or in CI auto-pushes/syncs schema directly to a live database. Applying
migrations is an explicit, reviewed step (`db:migrate`) run against a target
environment's `DATABASE_URL`.

Phase 0 ships this directory empty (placeholder schema only) — real migrations
begin once the approved domain schema is implemented in a later phase.

## Three connection strings (RLS Security Delta + Phase 7 Worker Boundary)

As of `0032_app_worker_role.sql`, this package uses **three** separate
connection strings, never fewer, and never one standing in for another:

- `DATABASE_URL` — the RUNTIME application connection, used by `apps/api` at
  request time. Authenticates as the least-privilege `app_runtime` Postgres
  role (`NOBYPASSRLS`), so Row Level Security policies (see
  `0005_rls_policies.sql`) are actually enforced for it.
- `MIGRATION_DATABASE_URL` — the PRIVILEGED connection used ONLY by
  `pnpm db:migrate` / `drizzle-kit generate`. Authenticates as the
  table-owning `postgres` role (BYPASSRLS by virtue of ownership), which is
  required to run DDL. Never used by request-serving application code.
- `WORKER_DATABASE_URL` — used ONLY by `apps/worker`'s outbox dispatcher
  (`packages/database/src/worker/outbox-dispatcher.ts`). Authenticates as
  the dedicated, least-privilege `app_worker` Postgres role
  (`NOBYPASSRLS`, see `0032_app_worker_role.sql`). This is a genuinely
  THIRD role, not a reuse of `app_runtime` or `postgres`: `app_runtime`
  has never had UPDATE on `outbox_events` (`0024_outbox_events.sql`'s own
  boundary — "status transitions belong to a future worker phase and its
  own role"), and widening it just to make a worker easy to bolt on would
  give every HTTP request-serving connection a capability it never needs.
  `app_worker` gets its own narrower grants instead (outbox claim/process
  + read/write only the domain tables the rule engine touches — see
  `0032`/`0033`'s own comments for the exact list).

### Provisioning a role's password per environment

`0006` creates `app_runtime` and `0032` creates `app_worker`, both with
`NOLOGIN` — **no password is ever committed to source control, and no
migration file itself contains a password.** Enable each role with a
one-time, out-of-band statement run directly against that environment's
database (the generated password is stored ONLY in that environment's
secret store / local `.env`, never in git, never in a migration):

```sql
ALTER ROLE app_runtime WITH LOGIN PASSWORD '<generated-secret>';
ALTER ROLE app_worker  WITH LOGIN PASSWORD '<generated-secret>';
```

Generate a fresh, sufficiently random secret per role per environment
(e.g. `openssl rand -base64 24`, or your secret manager's own generator) —
never reuse one role's password for another role, and never reuse a
password across environments (local/staging/production each get their
own `ALTER ROLE ... PASSWORD` run against their own database).

### Expected connection-string format (Supabase Session Pooler)

Supabase's Session Pooler (Supavisor) accepts custom roles via the same
`<role>.<project-ref>` username convention already used for `postgres` —
the ONLY thing that changes between the three connection strings is the
role prefix and password; host/port/database stay the same:

```text
DATABASE_URL=postgresql://app_runtime.<project-ref>:<app_runtime-password>@<host>:5432/postgres
MIGRATION_DATABASE_URL=postgresql://postgres.<project-ref>:<postgres-password>@<host>:5432/postgres
WORKER_DATABASE_URL=postgresql://app_worker.<project-ref>:<app_worker-password>@<host>:5432/postgres
```

A bare `app_worker` username (no `.<project-ref>` suffix) will fail to
connect through the pooler with `no tenant identifier provided` — the
suffix is required, exactly as it already is for `app_runtime`.

### Fail-fast, not fallback

`apps/worker` reads `WORKER_DATABASE_URL` via
`packages/database/src/env.ts`'s `getWorkerDatabaseUrl()`, and
`apps/worker/src/main.ts` resolves it synchronously at the very start of
`bootstrap()` — before opening any connection or entering the polling
loop. If it is unset, the worker logs a clear error naming the missing
variable and exits with a non-zero status immediately. It never falls
back to `DATABASE_URL` (which would silently reuse `app_runtime`'s
narrower, wrong-shaped grants) or to `MIGRATION_DATABASE_URL` (which
would silently grant the worker `BYPASSRLS`/table-owner privileges it
must never have).

## Connection pool budget (Phase 10 scale-review finding)

The shared development Supabase project this codebase has used through
every phase's live integration tests enforces a **hard cap of 15
simultaneous session-mode connections** (Supavisor's own limit for this
project's current tier — confirmed empirically during the Phase 10 load
test: `EMAXCONNSESSION: max clients reached in session mode - max clients
are limited to pool_size: 15`).

Production code's own pool sizes already assume real headroom that this
project's actual tier does NOT provide:

| Connection | Pool size (code) |
|---|---|
| `app_runtime` (`getDb()`, `packages/database/src/connection.ts`) | max 10 |
| `app_worker` (`getWorkerDb()`) | max 5 |
| `MIGRATION_DATABASE_URL` (migrations, ad-hoc admin scripts) | typically 1-2, but load/scale tooling can request more |

A single API instance (10) + a single worker instance (5) already consumes
the ENTIRE 15-connection budget on this project's tier, with zero headroom
for a migration/admin connection, a second API instance (horizontal
scaling), or this package's own live integration test suite running
concurrently. This is exactly why `vitest.config.ts` already sets
`fileParallelism: false` for this package (serializing integration test
files) — and it is also why any load-testing/scale-seeding script in
`src/scripts/` must keep its own connection pool small (`connect_timeout`
+ a conservative `max`) rather than assuming generous headroom.

**Trigger point for a paid/larger Supabase tier (or a dedicated
PgBouncer/pooler in front of Postgres) is exactly this**: the moment a
second concurrently-running API or worker instance is needed (horizontal
scaling — Technical Architecture §23's own stated evolution path), the
current 15-connection cap is already fully consumed by ONE of each. This
is not a code defect — `app_runtime`/`app_worker`'s pool sizes are
reasonable for a single-instance deployment — it is a real, measured
infrastructure ceiling that must be raised (or fronted by a proper
transaction-mode pooler) before horizontal scaling or heavier concurrent
tooling (this package's own load tests included) can run reliably
alongside the live application.
