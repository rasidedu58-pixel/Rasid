import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl } from "./env";

/**
 * Small migration runner script (`pnpm db:migrate`).
 *
 * Applies generated SQL migrations from src/migrations against the target
 * `DATABASE_URL`. This is the only production schema-change path — nothing
 * in this package auto-pushes/syncs schema outside of applying reviewed
 * migrations.
 */
async function main() {
  const connectionString = getDatabaseUrl();
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
