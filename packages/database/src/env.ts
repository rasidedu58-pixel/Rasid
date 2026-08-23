import { z } from "zod";

/**
 * Database package env schema.
 *
 * `DATABASE_URL` is the RUNTIME application connection string — used by
 * request-serving code (apps/api) at request time. As of the RLS Security
 * Delta it is expected to authenticate as the least-privilege `app_runtime`
 * Postgres role (NOBYPASSRLS), so Row Level Security policies are actually
 * enforced for it (see migrations/0006_runtime_role_least_privilege.sql).
 *
 * `MIGRATION_DATABASE_URL` is the separate, PRIVILEGED connection string
 * (table-owning `postgres` role) used ONLY by the migration runner
 * (packages/database/src/migrate.ts) and drizzle-kit tooling — never by
 * request-serving application code.
 *
 * Both are optional at the schema level so importing this module never
 * requires a live database — callers that actually need a connection must
 * call `getDatabaseUrl()` / `getMigrationDatabaseUrl()`, which throw only at
 * the point of use.
 */
const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().optional(),
  MIGRATION_DATABASE_URL: z.string().optional(),
});

export function loadDatabaseEnv(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
) {
  return databaseEnvSchema.parse(source);
}

/**
 * Returns a validated `DATABASE_URL` (the runtime/least-privilege
 * `app_runtime` connection), throwing only when something actually tries to
 * connect without one configured. Never call this at module import time.
 */
export function getDatabaseUrl(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string {
  const { DATABASE_URL } = loadDatabaseEnv(source);
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Configure it before attempting a database connection.",
    );
  }
  return DATABASE_URL;
}

/**
 * Returns the privileged migration/admin connection string
 * (`MIGRATION_DATABASE_URL`, table-owning `postgres` role), falling back to
 * `DATABASE_URL` ONLY when `MIGRATION_DATABASE_URL` is not set (logged as a
 * warning by the caller — see migrate.ts). Never call this at module import
 * time.
 */
export function getMigrationDatabaseUrl(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): string {
  const { MIGRATION_DATABASE_URL, DATABASE_URL } = loadDatabaseEnv(source);
  const url = MIGRATION_DATABASE_URL ?? DATABASE_URL;
  if (!url) {
    throw new Error(
      "Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Configure MIGRATION_DATABASE_URL " +
        "(privileged connection) before running migrations.",
    );
  }
  return url;
}
