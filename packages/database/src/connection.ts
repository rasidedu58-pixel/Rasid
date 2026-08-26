import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { getDatabaseUrl, getPlatformAdminDatabaseUrl, getWorkerDatabaseUrl } from "./env";
import * as schema from "./schema/index";

/**
 * PostgreSQL connection abstraction, appropriate for server/container use.
 *
 * Safe to import without a live database: the underlying `postgres` client
 * connects lazily on first query, and this module never opens a connection
 * at import time. `getDb()` is the only entry point that instantiates the
 * client, and it does so once (singleton), reading `DATABASE_URL` (the
 * RUNTIME application connection — as of the RLS Security Delta this
 * authenticates as the least-privilege `app_runtime` role, NOBYPASSRLS, so
 * RLS policies are actually enforced) via the zod-validated env module.
 */
let client: Sql | undefined;
let db: PostgresJsDatabase<typeof schema> | undefined;

/**
 * Phase 15B — shared pool-option builder for all three runtime roles.
 *
 * `prepare: false` is switched on automatically when the URL targets the
 * Supavisor TRANSACTION pooler (port 6543): transaction mode multiplexes
 * many client connections over few backend connections, so named prepared
 * statements (which live on a specific backend session) would break.
 * Live-verified against this project's own transaction pooler before this
 * change: RLS `set_config(..., true)` stays transaction-scoped (no leak
 * between pooled statements), tenant isolation holds (foreign-workspace
 * read returns 0 rows), and `FOR UPDATE SKIP LOCKED` outbox claiming is
 * transaction-contained by construction.
 *
 * Pool sizes are env-tunable because the safe number depends on the
 * deployment shape (replica count × pool must stay within each role's own
 * Postgres CONNECTION LIMIT — exceeding it FAILS with error 53300 rather
 * than queueing, measured live). Defaults preserve prior behavior.
 */
function poolOptions(url: string, envVar: string, defaultMax: number): Parameters<typeof postgres>[1] {
  const raw = process.env[envVar];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const max = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMax;
  const isTransactionPooler = /:6543\//.test(url);
  return {
    max,
    prepare: isTransactionPooler ? false : true,
    // Fail loudly instead of hanging forever when the pooler/DB is
    // saturated or unreachable (same rationale as the Phase 10 load-test
    // fix — a silent infinite hang is the worst failure mode).
    connect_timeout: 15,
    // Release idle connections back to the shared budget; the role
    // CONNECTION LIMIT is a cross-process budget, so holding idle
    // connections starves other consumers (measured: the API's idle
    // session connections consumed the role budget during external tests).
    idle_timeout: 60,
    max_lifetime: 60 * 30,
  };
}

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) {
    const url = getDatabaseUrl();
    client = postgres(url, poolOptions(url, "DB_POOL_MAX", 10));
    db = drizzle(client, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    db = undefined;
  }
  if (workerClient) {
    await workerClient.end({ timeout: 5 });
    workerClient = undefined;
    workerDb = undefined;
  }
  if (platformAdminClient) {
    await platformAdminClient.end({ timeout: 5 });
    platformAdminClient = undefined;
    platformAdminDb = undefined;
  }
}

// ---------------------------------------------------------------------------
// Worker connection (Phase 7) — a SEPARATE singleton, authenticating as the
// dedicated least-privilege `app_worker` role (never `app_runtime`, never
// the migration/admin role). See migrations/0032_app_worker_role.sql for
// the full rationale.
// ---------------------------------------------------------------------------

let workerClient: Sql | undefined;
let workerDb: PostgresJsDatabase<typeof schema> | undefined;

export function getWorkerDb(): PostgresJsDatabase<typeof schema> {
  if (!workerDb) {
    // Phase 15B: default lowered 5 → 3. The worker is one sequential
    // polling loop — it never needs 5 concurrent connections, and its
    // previous pool max equalled its role's CONNECTION LIMIT exactly
    // (zero self-headroom, reproduced as a real error in Phase 10's own
    // README). 3 leaves genuine slack inside the role budget.
    const url = getWorkerDatabaseUrl();
    workerClient = postgres(url, poolOptions(url, "WORKER_DB_POOL_MAX", 3));
    workerDb = drizzle(workerClient, { schema });
  }
  return workerDb;
}

/**
 * Worker-role equivalent of {@link withRuntimeContext} — runs `callback`
 * inside a transaction on the `app_worker` connection with
 * `app.workspace_id` set via `SET LOCAL` for the lifetime of that
 * transaction. The outbox dispatcher calls this ONCE it has read an
 * event's own `workspace_id` (outbox claiming itself happens outside any
 * workspace context — see the worker-only RLS policies in 0032 — since the
 * dispatcher doesn't know which workspace an event belongs to until it
 * reads the row).
 */
export function withWorkerRuntimeContext<T>(
  params: { workspaceId: string },
  callback: (scopedDb: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return getWorkerDb().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.workspace_id', ${params.workspaceId}, true)`);
    return callback(tx as unknown as PostgresJsDatabase<typeof schema>);
  });
}

// ---------------------------------------------------------------------------
// Platform-admin connection (Phase 12) — a THIRD separate singleton,
// authenticating as the dedicated least-privilege `app_platform_admin`
// role (never `app_runtime`, never `app_worker`). See
// migrations/0048_platform_admin.sql for the full rationale: this is the
// ONLY connection in the codebase with unrestricted cross-tenant SELECT on
// workspaces/users/memberships/subscriptions/entitlements, by design, for
// the platform owner's own backoffice.
// ---------------------------------------------------------------------------

let platformAdminClient: Sql | undefined;
let platformAdminDb: PostgresJsDatabase<typeof schema> | undefined;

export function getPlatformAdminDb(): PostgresJsDatabase<typeof schema> {
  if (!platformAdminDb) {
    // Phase 15B: default lowered 5 → 2 — the platform-admin backoffice is
    // a single human's read-only console; it must never reserve budget
    // the teacher-facing API needs.
    const url = getPlatformAdminDatabaseUrl();
    platformAdminClient = postgres(url, poolOptions(url, "PLATFORM_ADMIN_DB_POOL_MAX", 2));
    platformAdminDb = drizzle(platformAdminClient, { schema });
  }
  return platformAdminDb;
}

/**
 * Runs `callback` inside a transaction with `app.user_id` and/or
 * `app.workspace_id` set for the lifetime of that transaction (`SET LOCAL`
 * — scoped to the transaction, never leaks to other connections/requests
 * pooled afterward). This backs the Phase 2 RLS policies (Technical
 * Architecture §6, Database Schema §16) as actually enforced by the RLS
 * Security Delta's least-privilege `app_runtime` role: defense-in-depth
 * only — application-level authorization remains the actual authority,
 * this is not a substitute for it.
 *
 * Only params that are actually present are set: `current_setting(...,
 * true)` returning NULL (unset) behaves differently from an empty string
 * cast to uuid, so `userId`/`workspaceId` are each skipped, not set to "",
 * when undefined.
 */
export function withRuntimeContext<T>(
  params: { userId?: string; workspaceId?: string },
  callback: (scopedDb: PostgresJsDatabase<typeof schema>) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    // `set_config(..., true)` is the transaction-scoped ("SET LOCAL")
    // equivalent that supports a bound parameter (`SET LOCAL x = $1` is not
    // valid Postgres syntax — SET does not accept bind parameters).
    //
    // Phase 15 latency fix: both configs are set in ONE statement (one
    // network round-trip instead of two). Measured on the real deployed
    // topology, every round-trip to the eu-west-1 pooler costs ~75-150ms,
    // so an extra sequential statement here was a real, user-visible cost
    // on every RLS-scoped request.
    if (params.userId !== undefined && params.workspaceId !== undefined) {
      await tx.execute(
        sql`SELECT set_config('app.user_id', ${params.userId}, true), set_config('app.workspace_id', ${params.workspaceId}, true)`,
      );
    } else if (params.userId !== undefined) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${params.userId}, true)`);
    } else if (params.workspaceId !== undefined) {
      await tx.execute(sql`SELECT set_config('app.workspace_id', ${params.workspaceId}, true)`);
    }
    return callback(tx as unknown as PostgresJsDatabase<typeof schema>);
  });
}
