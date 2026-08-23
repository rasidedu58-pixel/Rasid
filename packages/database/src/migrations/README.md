# migrations

Generated Drizzle SQL migrations live here (`pnpm --filter @academic-precision/database db:generate`).

**Migrations are the only production schema-change path.** No script in this
package or in CI auto-pushes/syncs schema directly to a live database. Applying
migrations is an explicit, reviewed step (`db:migrate`) run against a target
environment's `DATABASE_URL`.

Phase 0 ships this directory empty (placeholder schema only) — real migrations
begin once the approved domain schema is implemented in a later phase.

## Two connection strings (RLS Security Delta)

As of `0006_runtime_role_least_privilege.sql`, this package uses **two**
separate connection strings, never one:

- `DATABASE_URL` — the RUNTIME application connection, used by `apps/api` at
  request time. Authenticates as the least-privilege `app_runtime` Postgres
  role (`NOBYPASSRLS`), so Row Level Security policies (see
  `0005_rls_policies.sql`) are actually enforced for it.
- `MIGRATION_DATABASE_URL` — the PRIVILEGED connection used ONLY by
  `pnpm db:migrate` / `drizzle-kit generate`. Authenticates as the
  table-owning `postgres` role (BYPASSRLS by virtue of ownership), which is
  required to run DDL. Never used by request-serving application code.

`0006` creates the `app_runtime` role with `NOLOGIN` — no password is ever
committed to source control. Enable it per environment with a one-time,
out-of-band statement run directly against that environment's database
(value stored only in the deployment's secret store / local `.env`, never
in git):

```sql
ALTER ROLE app_runtime WITH LOGIN PASSWORD '<secret, generated per environment>';
```

After that, set `DATABASE_URL` for that environment to
`postgresql://app_runtime.<project-ref>:<password>@<host>:5432/postgres`
(Supabase's Session Pooler accepts custom roles via the same
`<role>.<project-ref>` username convention already used for `postgres`),
and set `MIGRATION_DATABASE_URL` to the existing privileged `postgres`
connection string.
