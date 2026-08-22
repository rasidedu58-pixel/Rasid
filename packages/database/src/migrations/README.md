# migrations

Generated Drizzle SQL migrations live here (`pnpm --filter @academic-precision/database db:generate`).

**Migrations are the only production schema-change path.** No script in this
package or in CI auto-pushes/syncs schema directly to a live database. Applying
migrations is an explicit, reviewed step (`db:migrate`) run against a target
environment's `DATABASE_URL`.

Phase 0 ships this directory empty (placeholder schema only) — real migrations
begin once the approved domain schema is implemented in a later phase.
