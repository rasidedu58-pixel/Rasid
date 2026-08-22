import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration. Points at the (currently placeholder) schema
 * module and the migrations output directory. `dbCredentials.url` falls
 * back to a harmless local placeholder so `drizzle-kit generate` never
 * requires a live database connection string to run in Phase 0.
 */
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/academic_precision_dev",
  },
  verbose: true,
  strict: true,
});
