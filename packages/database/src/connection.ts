import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { getDatabaseUrl } from "./env";
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

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!db) {
    client = postgres(getDatabaseUrl(), { max: 10 });
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
    if (params.userId !== undefined) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${params.userId}, true)`);
    }
    if (params.workspaceId !== undefined) {
      await tx.execute(sql`SELECT set_config('app.workspace_id', ${params.workspaceId}, true)`);
    }
    return callback(tx as unknown as PostgresJsDatabase<typeof schema>);
  });
}
