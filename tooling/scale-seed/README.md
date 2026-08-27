# scale-seed — STAGING-ONLY deterministic scale-data seeder + cleanup

A standalone tool that seeds large, **synthetic**, **deterministic** datasets
into a **staging** Postgres so dense-data regressions (query/index/load
shape) can be reproduced, and then removes every seeded row with **zero
residue**.

> ⚠️ **STAGING ONLY. NEVER POINT THIS AT PRODUCTION.**
> The tool refuses to run unless the target host looks like a Supabase host
> **and** you have explicitly set `SCALE_SEED_ALLOW=1`. It also seeds only
> obviously-fake data (Arabic-ish names, `@scale.invalid` emails, clearly
> fake phone numbers) and tags every row with the marker prefix
> `SCALE_SEED::` so cleanup is exact.

It writes bulk multi-row `INSERT`s directly (no HTTP / NestJS / business
rules) — a data-shape generator for testing, not a functional-correctness
tool.

## Requirements

- Node 20+.
- The repo's dependencies installed at the root (`pnpm install`). The tool
  resolves the `postgres` driver from `packages/database` — it is
  **intentionally not** a pnpm workspace package, so it does not modify
  `pnpm-workspace.yaml`.

## Environment variables (required)

| Var | Meaning |
| --- | --- |
| `SCALE_SEED_DATABASE_URL` | Staging (privileged / migration-level) Postgres URL. Must bypass RLS to insert cross-tenant fixtures — use the migration/owner role, never `app_runtime`, never production. Host must contain `supabase.co` (also matches `*.pooler.supabase.com`). Never hardcoded. |
| `SCALE_SEED_ALLOW` | Must be exactly `1`. Explicit staging opt-in; the tool refuses otherwise. |

Copy `.env.example` to `.env` and load it into your shell yourself (the tool
does **not** auto-load `.env`):

```bash
cd tooling/scale-seed
cp .env.example .env
# edit .env, then:
set -a; . ./.env; set +a
```

## Usage

```bash
# Seed a profile (from the tooling/scale-seed directory):
node scale-seed.mjs --profile dense-3000
node scale-seed.mjs --profile workspaces-100
node scale-seed.mjs --profile workspaces-500
node scale-seed.mjs --profile workspaces-1000

# Report how many marked rows currently exist, per table:
node scale-seed.mjs --verify

# Remove EVERY seeded row (FK-safe order) and print zero-residue proof:
node scale-seed.mjs --cleanup

# Help:
node scale-seed.mjs --help
```

Equivalent npm scripts: `npm run seed:dense-3000`, `npm run verify`,
`npm run cleanup`, etc.

### Profiles

| Profile | Workspaces | Students/ws | Groups/ws | Memberships/ws | Sessions/group-month |
| --- | --- | --- | --- | --- | --- |
| `probe` | 1 | 2 | 1 | 0 | 2 |
| `dense-3000` | 1 | 3,000 | 75 | 3 | 12 |
| `workspaces-100` | 100 | 40 | 2 | 1 | 8 |
| `workspaces-500` | 500 | 40 | 2 | 1 | 8 |
| `workspaces-1000` | 1,000 | 40 | 2 | 1 | 8 |

Each seed also creates the realistic downstream footprint: one CURRENT
operating month per workspace, one `group_month` per group, one enrollment
per student (round-robin across the workspace's group-months), completed
sessions per group-month, one `session_record` per (session × enrollment),
one `financial_obligation` per enrollment, and `payments` for the paid/partial
obligations (~40% PAID / ~25% PARTIAL / ~35% UNPAID).

### Overriding counts

Any preset value can be overridden (flags win over the profile):

```bash
node scale-seed.mjs --profile workspaces-100 --students-per-workspace 60 \
  --sessions-per-group-month 4 --batch-size 500
```

Flags: `--workspaces`, `--students-per-workspace`, `--groups-per-workspace`,
`--memberships-per-workspace`, `--sessions-per-group-month`, `--batch-size`
(default 1000, capped at 1000), `--seed` (default 42).

### Determinism

Given the same `--seed <int>`, all ids and all data are reproducible. Ids are
derived from `sha256(seed|kind|index)` formatted as UUIDv4 (no `randomUUID`),
and all variety (fee tiers, attendance, paid/unpaid split) comes from a
seeded hash-based PRNG (no `Math.random`). All timestamps are fixed calendar
constants (no `Date.now` in seeded data; `Date.now` is used only for the
elapsed-time progress meter).

Re-running the same profile+seed will collide on unique keys (e.g.
`students(workspace_id, student_code)`) — clean up first, or use a different
`--seed`, to re-seed.

## Ownership & cleanup model

Every seeded row is tagged with the `SCALE_SEED::` marker on a text column
(`workspaces.name`, `users.full_name`). Cleanup re-discovers the seeded
workspaces by that marker and cascades deletes in FK-safe order — so it works
even if the local manifest is lost. A JSON manifest is also written under
`manifests/` (git-ignored) as a secondary record and totals summary.

`--cleanup` finishes by running the same count query `--verify` uses and
asserts every marked count is `0` (exit code 3 if any residue remains).

## Suggested first live run (operator step)

The safe first validation is the tiny `probe` profile:

```bash
node scale-seed.mjs --profile probe   # seeds 1 workspace, 2 students
node scale-seed.mjs --verify          # shows the marked rows
node scale-seed.mjs --cleanup         # removes them, proves zero residue
```

## What it does NOT touch

Only the tables listed above. It never deletes anything not tagged with the
`SCALE_SEED::` marker, and never targets rows by anything other than the
marked workspace ids (plus marked `users.full_name`).
