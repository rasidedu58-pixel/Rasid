/**
 * Schema module: workspace_invitations (Team & Permissions — Phase 2).
 *
 * A pending invitation is NOT a membership: `memberships.user_id` is NOT
 * NULL with a FK to `users`, so an invite for someone who may not even have
 * an account yet cannot live there. This table holds the invite until it is
 * accepted, at which point a real `memberships` row (status ACTIVE) is
 * created and this row is marked ACCEPTED — atomically, in one transaction.
 *
 * SECURITY — same bearer-secret convention as `qr_credentials`:
 *   * `token_hash` stores a SHA-256 hex digest ONLY. The raw invite token is
 *     never persisted anywhere and never logged; it is returned to the owner
 *     exactly once (at creation) so they can build the shareable link.
 *   * Lookups are always exact-hash (`WHERE token_hash = $1`) on a
 *     high-entropy digest — no enumeration surface.
 *   * `desired_grants` snapshots the role + permission scope chosen at invite
 *     time, so acceptance grants exactly what the owner authorized.
 */
import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { workspaces } from "./workspaces";
import { users } from "./identity";

/** Stored shape of one pre-authorized grant (mirrors `DesiredGrantInput`). */
export interface InvitationDesiredGrant {
  permissionKey: string;
  scopeType: "ALL_GROUPS" | "SELECTED_GROUPS";
  groupIds?: string[];
}

export const workspaceInvitations = pgTable(
  "workspace_invitations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Denormalized tenant key — indexing + RLS (workspace-isolation policy).
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    /** SHA-256 hex digest of the raw invite token — never the raw token itself. */
    tokenHash: text("token_hash").notNull(),
    /** Membership role label applied on acceptance (never "OWNER"). */
    roleLabel: text("role_label").notNull(),
    /** Pre-authorized grants applied on acceptance (InvitationDesiredGrant[]). */
    desiredGrants: jsonb("desired_grants").$type<InvitationDesiredGrant[]>().notNull(),
    /** Optional owner-facing note ("for whom") — display only, never gates acceptance. */
    invitedLabel: text("invited_label"),
    status: text("status").notNull().default("PENDING"),
    invitedByUserId: uuid("invited_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id, { onDelete: "restrict" }),
    /** The membership created on acceptance (null until accepted). */
    acceptedMembershipId: uuid("accepted_membership_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    check("workspace_invitations_status_check", sql`${table.status} IN ('PENDING', 'ACCEPTED', 'REVOKED')`),
    // Exact-hash lookup path for accept/preview — never fuzzy; also enforces
    // global token uniqueness.
    uniqueIndex("workspace_invitations_token_hash_unique").on(table.tokenHash),
    index("workspace_invitations_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);
