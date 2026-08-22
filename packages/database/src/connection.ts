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
 * client, and it does so once (singleton), reading `DATABASE_URL` via the
 * zod-validated env module.
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
