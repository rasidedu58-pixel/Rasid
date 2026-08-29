# Rasid — Automated Production Database Backups

Fully automatic, off-machine backups of the Rasid Production PostgreSQL
database (Supabase project `sbzksiidurpofzteyxsu`) using **GitHub Actions +
Backblaze B2**. It runs independently of any laptop or of Claude.

## Architecture

Two GitHub Actions workflows:

| Workflow | File | Schedule | What it does |
|---|---|---|---|
| **Backup** | `.github/workflows/production-backup.yml` | daily **03:00 UTC** + manual | `pg_dump` (custom format) of Production → validate → upload to B2 → prune old backups |
| **Restore verification** | `.github/workflows/production-backup-verify.yml` | weekly **Mon 04:00 UTC** + manual | download newest backup → verify SHA-256 → restore into a **disposable** PostgreSQL 17 service → assert structure/RLS/migrations |

Scripts (`scripts/backup/`): `lib.sh` (shared helpers), `backup.sh` (dump +
validate + metadata), `upload.sh` (B2 upload), `retention.sh` (30-day prune),
`verify-restore.sh` (weekly restore proof), and `b2.py` (the single B2
transport).

**B2 transport:** all Backblaze operations (upload / head / list / download /
delete) go through one client, `b2.py`, which uses the **Backblaze B2 Native
API** over the Python standard library — never the S3-compatibility layer.
The AWS S3 SDKs (AWS CLI v2 >= 2.23 and boto3/botocore >= 1.36) attach default
integrity checksums to PutObject and send the body with `aws-chunked` /
trailing-checksum framing that B2 rejects with `IncompleteBody: The request
body was too small`; `request_checksum_calculation=when_required` did not
reliably disable it (it failed on real B2 with both `aws s3 cp` and
`boto3.put_object`). The native upload is a single plain HTTPS POST of the raw
bytes with an `X-Bz-Content-Sha1` the server verifies — no chunking, no SDK
checksum middleware, `Content-Length` always equal to the object size — so it
is immune to that failure class. No third-party Python packages are required
(stdlib only). A manual **B2 Transport Self-Test** workflow
(`production-backup-selftest.yml`) exercises upload/head/list/download/delete
against the real bucket with a throwaway object under `production/_selftest/`
(no Production DB access) so the transport can be proven before a full run.

**Backup method:** `pg_dump --format=custom --no-owner --no-privileges
--schema=public --schema=drizzle`. The custom (`-Fc`) archive is portable and
restorable with `pg_restore`. It contains **schema, data, indexes, constraints,
sequences, functions, triggers, and RLS policies** for `public`, plus the
`drizzle` schema (Drizzle **migration state**, `drizzle.__drizzle_migrations`).
`--no-owner --no-privileges` makes the artifact portable across clusters
(Supabase-managed ownership/GRANTs are environment-specific and are recreated
by the app's own migrations/role provisioning on any real restore).
System schemas (`auth`, `storage`, …) are intentionally excluded — they are
Supabase-managed and not part of the Rasid application database.

**Why schema-restricted (not a whole-database dump):** Production is
Supabase-managed. A whole-database `pg_dump` would pull in Supabase-internal
schemas (`auth`, `storage`, `graphql`, `vault`, `extensions`, `realtime`, …)
and **Supabase-only extensions** (`pg_graphql`, `supabase_vault`, `pgsodium`,
…) that (a) the `postgres` role cannot always fully dump and (b) **cannot be
restored into a clean vanilla PostgreSQL 17** — so a whole-DB dump is *less*
recoverable, not more. The Rasid application database is `public` + `drizzle`,
and that is exactly what we capture.

**Disaster-recovery platform prerequisites.** By PostgreSQL's own definition a
schema-restricted dump is not guaranteed self-contained: it does **not** emit
`CREATE EXTENSION` or the cluster-global roles the RLS policies reference. Those
are **documented platform prerequisites** provisioned on the target *before*
`pg_restore` (the weekly verification does exactly this):
- **Roles** (as `NOLOGIN`): `app_runtime, app_worker, app_platform_admin, anon,
  authenticated, service_role, authenticator`.
- **Extension**: `pg_trgm` **in `public`** — Rasid migration `0015` runs
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and builds the GIN trigram index
  `students_search_name_trgm_idx` (`… USING gin (… public.gin_trgm_ops)`).
  `pg_trgm` is the **only** extension the application requires.
Each backup's `metadata.json` records `installedExtensions`,
`appRequiredExtensions` (`pg_trgm`), and `platformPrerequisites`. With these
prerequisites in place the artifact restores completely into a clean
PostgreSQL 17. gen_random_uuid() is core in PostgreSQL 13+, so no `pgcrypto`
prerequisite is needed.

**Connection:** only via the `SUPABASE_PROD_DB_URL` secret — the Production
`postgres` admin role over the **Session Pooler (port 5432)**. The admin role
is required so the dump reads *all* rows (it bypasses RLS); the Session Pooler
is IPv4-compatible (GitHub runners are IPv4) and session-mode (the transaction
pooler on 6543 is not usable by `pg_dump`).

## Secrets required (GitHub → repo → Settings → Secrets and variables → Actions)

| Secret | Purpose |
|---|---|
| `SUPABASE_PROD_DB_URL` | Production `postgres` admin Session-Pooler URI (`…@aws-<n>-eu-west-1.pooler.supabase.com:5432/postgres`) |
| `B2_KEY_ID` | Backblaze application key id |
| `B2_APPLICATION_KEY` | Backblaze application key |
| `B2_BUCKET_NAME` | private B2 bucket name |
| `B2_ENDPOINT` | B2 S3 endpoint, e.g. `s3.us-west-004.backblazeb2.com` |

Secrets are referenced only as `${{ secrets.* }}` and read from env in the
scripts — never printed, never committed. GitHub also masks them in logs.

## Object layout in B2

```
production/YYYY/MM/DD/rasid-production-YYYY-MM-DD-HHMMSS.dump
production/YYYY/MM/DD/rasid-production-YYYY-MM-DD-HHMMSS.dump.sha256
production/YYYY/MM/DD/rasid-production-YYYY-MM-DD-HHMMSS.metadata.json
```

`metadata.json` records: UTC timestamp, project ref, source PostgreSQL version,
git commit, artifact name/size, SHA-256, method, verification status — **no
secrets or connection strings**.

## Manual backup trigger

GitHub → **Actions** → **Production DB Backup** → **Run workflow**
(`workflow_dispatch`). Or via CLI:

```bash
gh workflow run "Production DB Backup"
```

## Finding backups in B2

- Backblaze web UI → the bucket → browse `production/YYYY/MM/DD/`.
- Or with the AWS CLI (using the B2 S3 endpoint):
  ```bash
  aws s3 ls "s3://$B2_BUCKET_NAME/production/" --recursive --endpoint-url "https://$B2_ENDPOINT"
  ```
The newest `.dump` is the most recent successful backup.

## Retention policy

`retention.sh` (in the daily workflow) deletes objects under `production/`
older than **30 days**, but **never** deletes the newest `.dump` and its
sibling group (`.dump.sha256`, `.metadata.json`). Deletion is scoped strictly
to the `production/` prefix; anything outside it is skipped. (Complementary
B2 lifecycle rules and object-lock can be added in the bucket for defence in
depth.)

## Weekly restore verification

`production-backup-verify.yml` proves the backups are actually restorable:
it downloads the newest `.dump`, verifies its SHA-256, pre-creates the app
roles the RLS policies reference (they are cluster-global and not in the dump),
and restores into a throwaway `postgres:17` **service container** (localhost
only — never Production/Staging). The restore is done **in sections** so the
`pg_trgm` prerequisite is provisioned (into `public`) between `pre-data`
(schemas/tables) and `post-data` (the GIN trigram index), with `--exit-on-error`
on every section. It then asserts: `public` and `drizzle` schemas exist; the six
key tables (`users`, `workspaces`, `students`, `sessions`,
`financial_obligations`, `memberships`) exist; **RLS is enabled on
`public.users`** and on ≥30 tables; `drizzle.__drizzle_migrations` is populated;
**`pg_trgm` is installed** and **`students_search_name_trgm_idx` exists as a GIN
`gin_trgm_ops` index**; and the DB is queryable (`select … from public.students`).
The container is destroyed automatically at job end.

## Emergency restore procedure (Production recovery)

> This restores a backup into a **NEW/disposable** target first — never
> straight over Production. Cross-reference `docs/BACKUP_RESTORE_RUNBOOK.md`.

1. **Get the artifact.** Identify the backup to restore (newest, or a specific
   day) and download the `.dump` + `.dump.sha256` from B2:
   ```bash
   aws s3 cp "s3://$B2_BUCKET_NAME/production/YYYY/MM/DD/<name>.dump"        . --endpoint-url "https://$B2_ENDPOINT"
   aws s3 cp "s3://$B2_BUCKET_NAME/production/YYYY/MM/DD/<name>.dump.sha256" . --endpoint-url "https://$B2_ENDPOINT"
   echo "$(cat <name>.dump.sha256)  <name>.dump" | sha256sum -c -
   ```
2. **Provision a fresh target** (a new Supabase project or a local PostgreSQL
   17). **Do not restore over live Production yet.**
3. **Pre-create roles** the policies reference on the target:
   `app_runtime, app_worker, app_platform_admin, anon, authenticated,
   service_role, authenticator` (as `NOLOGIN`), then set their real passwords
   out-of-band where applicable.
4. **Restore in sections**, provisioning the `pg_trgm` prerequisite between
   schema/table creation and index creation (the dump is schema-restricted, so
   it does not create the extension the trigram index needs):
   ```bash
   pg_restore --no-owner --no-privileges --exit-on-error --section=pre-data  --dbname "<TARGET_ADMIN_URL>" <name>.dump
   psql "<TARGET_ADMIN_URL>" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;"
   pg_restore --no-owner --no-privileges --exit-on-error --section=data      --dbname "<TARGET_ADMIN_URL>" <name>.dump
   pg_restore --no-owner --no-privileges --exit-on-error --section=post-data --dbname "<TARGET_ADMIN_URL>" <name>.dump
   ```
   (`--exit-on-error` is kept on every section — nothing is suppressed.)
5. **Verify** on the target: schemas (`public`, `drizzle`), key tables, RLS on
   `users`, the **`pg_trgm` extension and `students_search_name_trgm_idx`**,
   migration count in `drizzle.__drizzle_migrations`, and finance integrity —
   as the weekly job and the 15F verifier do.
6. **Promote** only after verification passes: repoint the application's
   database env to the restored target (or use Supabase's own restore-over-
   project flow), monitor, and keep the pre-restore snapshot until closed.

## Credential rotation

- **Production DB password** (`SUPABASE_PROD_DB_URL`): rotate in Supabase →
  Settings → Database → reset password; rebuild the Session-Pooler URI with the
  new password; update the `SUPABASE_PROD_DB_URL` GitHub secret. No code change;
  the next scheduled run uses the new value.
- **Backblaze keys** (`B2_KEY_ID` / `B2_APPLICATION_KEY`): create a new
  application key scoped to the backup bucket in Backblaze, update both GitHub
  secrets, then delete the old key. Prefer a key restricted to the single
  backup bucket (least privilege).
- Rotating any secret requires **no** workflow edit — only the secret value.

## Guarantees

Read-only against Production (a `pg_dump` + one `show server_version`); no
migrations, tests, seeds, application writes, or Staging access. Restore
testing is fully isolated in a disposable container. Any failure (dump,
checksum, validation, upload, retention, or weekly restore) fails the workflow
visibly, using GitHub's native failure notifications.
