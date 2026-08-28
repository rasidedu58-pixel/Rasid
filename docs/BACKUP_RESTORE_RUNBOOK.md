# Rasid — Backup & Restore Runbook

**Audience:** the operator on call (does not need to be a programmer for the HUMAN ACTION steps).
**Scope:** how to verify a backup exists, restore it to a disposable target, and prove Rasid still works after the restore. Produced by Phase 15F (the backup/restore drill).

Every step is labelled:

- **[AUTOMATED]** — a script does it; you run one command.
- **[HUMAN ACTION]** — a person must click/decide in the Supabase (or Railway) dashboard.
- **[PAID INFRA LIMIT]** — only available on a paid Supabase plan / add-on.

> **Golden rule (Phase 15F §0):** a backup shown in a dashboard is *not* proof. Recovery is proven only when: **backup exists → restore runs → Rasid works on the restored data.** The `recovery:*` scripts below verify the third step against exact expected values.

---

## A. When to trigger recovery

Declare a recovery incident if any of these is true:

- Data loss or corruption is suspected (rows missing, finance totals wrong, mass unexpected deletes).
- A bad migration or bad deploy mutated production data destructively.
- The database is unavailable and Supabase status shows a project-level fault.
- A security incident may have tampered with data.

If it is only an *application* bug (UI wrong, endpoint 500) with the data intact — that is **not** a recovery incident. Fix forward instead.

---

## B. How to verify the latest backup — **[HUMAN ACTION]**

Rasid's database is a managed Supabase project (staging ref `lcosppsfikausgvoyxuh`; production ref is in the deployment secret store — never in git).

1. Open the Supabase dashboard → the project → **Database → Backups**.
2. Confirm a **daily automated backup** exists dated within the last 24h.
   - Free/Pro tiers take **daily** logical backups. Retention is plan-dependent (typically 7 days).
3. If the project is **Pro with the PITR add-on** — **[PAID INFRA LIMIT]** — confirm the **Point-in-Time-Recovery** window covers the timestamp you need (PITR restores to any second within the retention window; daily backups only to the nightly snapshot).

> Rasid cannot read backup/PITR status from code — there is no Management API token in the app's secrets, only the data-plane `service_role` key. Backup verification is therefore always a HUMAN ACTION in the dashboard.

---

## C. How to restore

Pick the strongest mechanism the plan offers (best first):

1. **PITR to a new project** — **[HUMAN ACTION]** **[PAID INFRA LIMIT]**
   Dashboard → Database → Backups → Point in Time → choose timestamp → **restore into a new project** (never overwrite production first). Fastest RPO (seconds).
2. **Daily backup restore to a new project** — **[HUMAN ACTION]**
   Dashboard → Backups → pick the backup → restore to a new/disposable project. RPO up to 24h.
3. **Logical dump + restore to a disposable Postgres** — **[AUTOMATED]** (proven in the Phase 15F drill; see §E/§H). Use when you need a fast, cheap, *local* correctness check of a dump artifact without provisioning a Supabase project.

> Always prefer restoring into a **disposable target** first, verifying it (§F–§H), and only then deciding to promote it (§K). Do **not** restore over live production until validation passes.

---

## D. How to create / select a disposable target — **[HUMAN ACTION]** (Supabase) / **[AUTOMATED]** (local)

- **Supabase disposable project:** dashboard → New Project (same region, `eu-west-1`) → note its connection string. This is the restore target for mechanisms 1–2.
- **Local disposable Postgres (drill method, no dashboard, no cost):** the Phase 15F drill boots a real PostgreSQL locally via `embedded-postgres`, rebuilds the schema from Rasid's own migrations, and loads a logical dump. This is what proves the dump artifact end-to-end; it is not a production target.

---

## E. Capture + dump (the backup artifact) — **[AUTOMATED]**

From `packages/database`, with `MIGRATION_DATABASE_URL` = the source (admin/`postgres`) connection string:

```bash
# 1. Snapshot the exact expected state (schema shape + fixture/domain state, finance in integer minor units)
MIGRATION_DATABASE_URL=... RECOVERY_IDS_FILE=./ids.json RECOVERY_MANIFEST_FILE=./manifest.json pnpm --filter @academic-precision/database recovery:manifest
# 2. Logical data dump of every public table (type-faithful via json_agg)
MIGRATION_DATABASE_URL=... RECOVERY_DUMP_FILE=./dump.jsonl pnpm --filter @academic-precision/database recovery:dump
```

Both are **read-only** on the source. Store `manifest.json` + `dump.jsonl` as the drill's backup artifact. **Never commit dumps or connection strings to git.**

> For a *production-grade* physical/logical backup, use Supabase's own backup (§B) or `pg_dump`/`supabase db dump` (needs the DB password + Docker) — the `recovery:dump` tool is the drill's disposable-target mechanism and the data-integrity checker, not a replacement for Supabase backups.

---

## F. Verification script command — **[AUTOMATED]**

Point the verifier at the **restored** target and the manifest captured from the source:

```bash
RECOVERY_TARGET_URL=<restored-db-url> RECOVERY_MANIFEST_FILE=./manifest.json pnpm --filter @academic-precision/database recovery:verify
```

Exit code `0` = every check passed. Non-zero = at least one mismatch (it prints exactly which). The verifier is read-only and compares schema shape (RLS-enabled tables, policies, triggers, indexes, enums), every launch-critical table's row count, and the fixture's exact domain state.

---

## G. Finance integrity checks — **[AUTOMATED]** (inside `recovery:verify`)

Finance is a **mandatory gate**. The verifier compares, as **exact integer minor-unit strings** (never a rendered total):

- every obligation's `net_due_minor` / `amount_paid_minor` / `remaining_minor` and derived status (`UNPAID` / `PARTIAL` / `PAID`);
- each payment row + its status (`POSTED` / `REVERSED`) — **immutable history**: a reversed payment row is preserved with status `REVERSED`, plus its `payment_reversals` row;
- aggregate `totalDue` / `totalPaid` / `totalRemaining` computed from the underlying rows.

A restored DB that fails any finance check is **not** promotable.

---

## H. RLS checks — **[AUTOMATED]** (requires two roles)

Rasid isolates tenants with `current_setting('app.workspace_id')` RLS policies enforced for the non-owner, `NOBYPASSRLS` **`app_runtime`** role (the `postgres`/migration role bypasses RLS by design).

On the restored target, verify:

- `app_runtime` with the correct `app.workspace_id` sees **only** that workspace's rows;
- a foreign `app.workspace_id` returns **0 rows**;
- **no** `app.workspace_id` set returns **0 rows** (app_runtime never bypasses);
- the migration/`postgres` role sees all rows (expected).

The Phase 15F drill runs all four automatically. To run the repo's full live RLS integration suite instead, set distinct `DATABASE_URL` (= `app_runtime`) and `MIGRATION_DATABASE_URL` (= `postgres`) at the restored target and run `pnpm --filter @academic-precision/database test`.

---

## I. Application smoke — **[AUTOMATED]** / **[HUMAN ACTION]** (for a live API)

- **DB-layer smoke [AUTOMATED]:** the drill calls real repository reads (`getMonthlyTeacherReport`, `getStudentReport`) against the restored DB and asserts correct results.
- **Full API smoke [HUMAN ACTION]:** to exercise the HTTP layer, point a **disposable** Railway API service (or a local `apps/api`) at the restored DB URL — never repoint production — and hit `/health`, `/ready`, `/me`, `/students`, `/groups`, a session detail + roster, `/finance` summary, collection queue, `/attention-cases`, `/notifications`, `/reports/monthly/:id`. All critical reads must return 200.

---

## J. RTO / RPO

- **RTO (measured, drill method):** logical dump → migrations → data load → full verification of the Phase 15F fixture completed in **~15 seconds** on a local disposable Postgres. A real Supabase project restore is dominated by project provisioning + snapshot apply — **[PLAN-DEPENDENT]**, typically minutes to tens of minutes; measure it once in the dashboard and record here.
- **RPO:**
  - Daily automated backup → **up to 24h** of potential data loss — **[PLAN-DEPENDENT]**.
  - PITR add-on → **seconds** (any point in the retention window) — **[PAID INFRA LIMIT]**.

---

## K. Production restore decision tree — **[HUMAN ACTION]**

```
Incident declared (§A)
  │
  ├─ Is data actually lost/corrupted?  ── No ─▶ Fix forward. NOT a recovery incident.
  │        │ Yes
  ▼
Freeze destructive writes if the cause is ongoing (put API in read-only / pause the worker).
  │
  ▼
Preserve current state FIRST: take a fresh backup / PITR bookmark of production AS-IS
(so a bad restore is itself reversible).  ── [HUMAN ACTION]
  │
  ▼
Choose restore point (§C). Restore into a NEW/disposable project — never over prod yet.
  │
  ▼
Verify restored target: schema (§F) → finance (§G) → RLS (§H) → app smoke (§I).
  │
  ├─ Any check FAILS ─▶ Do NOT promote. Pick an earlier restore point or escalate (§L).
  │        │ All pass
  ▼
Promote: repoint production traffic to the restored project (update the app's DB env in Railway),
or follow Supabase's "restore over project" once validation passed.  ── [HUMAN ACTION]
  │
  ▼
Monitor for 30–60 min (error rate, finance totals, auth). Roll back to the preserved
AS-IS snapshot if regressions appear.
```

---

## L. Escalation

- If two restore points both fail verification → escalate to the database owner + Supabase support (open a ticket referencing the project ref).
- If finance integrity cannot be restored → **stop**; do not promote. Finance is a hard gate.
- Keep the preserved AS-IS snapshot (decision-tree step) until the incident is fully closed.

---

## M. Cleanup & secrets handling — **[AUTOMATED]** + **[HUMAN ACTION]**

- Remove any drill fixture: `MIGRATION_DATABASE_URL=... RECOVERY_IDS_FILE=./ids.json pnpm --filter @academic-precision/database recovery:cleanup` **[AUTOMATED]**, then confirm zero residue.
- Destroy the disposable target: delete the local `pgdata_*` directory, or delete the disposable Supabase project in the dashboard **[HUMAN ACTION]**.
- **Secrets:** never commit dumps, `.env`, service-role keys, or DB passwords. Delete local dump/manifest artifacts after the drill. Connection strings live only in the deployment secret store and local `.env` (git-ignored).
- Run `ANALYZE` on the source only if a large temporary fixture was created and removed (the standard drill fixture is tiny — not required).
