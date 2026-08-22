import { z } from "zod";

/**
 * Database package env schema. `DATABASE_URL` is optional at the schema
 * level so importing this module never requires a live database — callers
 * that actually need a connection must call `getDatabaseUrl()`, which
 * throws only at the point of use.
 */
const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().optional(),
});

export function loadDatabaseEnv(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
) {
  return databaseEnvSchema.parse(source);
}

/**
 * Returns a validated `DATABASE_URL`, throwing only when something actually
 * tries to connect without one configured. Never call this at module import
 * time.
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
