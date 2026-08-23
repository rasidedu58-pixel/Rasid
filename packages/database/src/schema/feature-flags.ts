/**
 * Schema module: feature_flags
 *
 * Phase 5 Closure Delta — pulled forward from the Database Schema's
 * illustrative migration plan (`0020_seed_feature_flags_and_defaults`,
 * §21) for the same reason `audit_events` was pulled into Phase 2 and
 * `idempotency_records` into Phase 3: the current phase has a real,
 * approved need for it NOW (PRD §34: "Complete with gaps | Feature flag
 * `complete_session_with_missing_records`. Default False.") and the
 * governing docs never actually specify a `complete_with_gaps` value
 * anywhere OTHER than as a real, stored, default-false flag — a hardcoded
 * application constant was a Phase 5 shortcut, not the approved design.
 *
 * Deliberately GLOBAL (no `workspace_id`) — the PRD lists this alongside
 * `exam_drop_rule`/`trial entitlement` as product-wide policy toggles, not
 * a per-workspace setting, and no per-workspace configuration surface is
 * authorized in any phase yet. `app_runtime` gets SELECT only — there is
 * still no management/admin endpoint to change a flag's value (explicitly
 * out of scope per this delta's own instruction); only a future phase that
 * authorizes such an endpoint should add INSERT/UPDATE grants.
 */
import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});
