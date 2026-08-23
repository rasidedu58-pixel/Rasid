import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getMigrationDatabaseUrl, loadDatabaseEnv } from "./env";

/**
 * Small migration runner script (`pnpm db:migrate`).
 *
 * Applies generated SQL migrations from src/migrations against the
 * privileged `MIGRATION_DATABASE_URL` connection (table-owning `postgres`
 * role) — never against the least-privilege runtime `DATABASE_URL`
 * connection, which lacks the DDL/ownership privileges migrations require.
 * Falls back to `DATABASE_URL` (with a warning) only when
 * `MIGRATION_DATABASE_URL` is not set, for backward-compat in case a local
 * `.env` only has one URL configured — the correct/expected production
 * setup is both variables set separately. This is the only production
 * schema-change path — nothing in this package auto-pushes/syncs schema
 * outside of applying reviewed migrations.
 */
async function main() {
  const env = loadDatabaseEnv();
  if (!env.MIGRATION_DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.warn(
      "MIGRATION_DATABASE_URL is not set; falling back to DATABASE_URL for migrations. " +
        "The expected production setup configures MIGRATION_DATABASE_URL (privileged " +
        "`postgres` role) separately from the least-privilege runtime DATABASE_URL.",
    );
  }

  const connectionString = getMigrationDatabaseUrl();
  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  await migrate(db, { migrationsFolder: "./src/migrations" });
  await migrationClient.end();
  // eslint-disable-next-line no-console
  console.log("Migrations applied successfully.");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", error);
  process.exit(1);
});
