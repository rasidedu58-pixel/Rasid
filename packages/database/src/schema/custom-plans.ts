/**
 * Schema module: custom_plan_requests + custom_plan_offers — Billing Engine,
 * Phase 5. The negotiated-CUSTOM commercial layer (students > 3000). A request
 * is a customer lead; an offer is the platform-authored, VERSIONED answer whose
 * commercial facts are immutable (a revised price is a new version that
 * supersedes the prior). See migrations 0067/0068 for RLS/grants and the full
 * model. Money is `bigint` minor units (ADR-022).
 */
import { sql } from "drizzle-orm";
import { bigint, char, check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { workspaces } from "./workspaces";

export const customPlanRequests = pgTable(
  "custom_plan_requests",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    requestedMaxActiveStudents: integer("requested_max_active_students").notNull(),
    requestedMaxTeamMembers: integer("requested_max_team_members").notNull(),
    preferredBillingCycle: text("preferred_billing_cycle").notNull(),
    customerNote: text("customer_note"),
    /** Internal (admin-only) recommendation snapshot at request time — never shown to the customer in V1. */
    recommendedPriceMinor: bigint("recommended_price_minor", { mode: "number" }).notNull(),
    recommendedMaxTeamMembers: integer("recommended_max_team_members").notNull(),
    recommendationVersion: integer("recommendation_version").notNull(),
    status: text("status").notNull().default("PENDING_REVIEW"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    workspaceStatusIdx: index("custom_plan_requests_workspace_status_idx").on(t.workspaceId, t.status, t.createdAt),
    oneOpenPerWorkspace: uniqueIndex("custom_plan_requests_one_open_per_workspace").on(t.workspaceId).where(sql`status = 'PENDING_REVIEW'`),
    studentsCheck: check("custom_plan_requests_students_above_standard_check", sql`${t.requestedMaxActiveStudents} > 3000`),
    teamCheck: check("custom_plan_requests_team_nonnegative_check", sql`${t.requestedMaxTeamMembers} >= 0`),
    cycleCheck: check("custom_plan_requests_billing_cycle_check", sql`${t.preferredBillingCycle} IN ('MONTHLY', 'ANNUAL')`),
    statusCheck: check("custom_plan_requests_status_check", sql`${t.status} IN ('PENDING_REVIEW', 'OFFERED', 'CANCELLED', 'CLOSED')`),
  }),
);

export const customPlanOffers = pgTable(
  "custom_plan_offers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    customRequestId: uuid("custom_request_id").notNull().references(() => customPlanRequests.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "restrict" }),
    offerVersion: integer("offer_version").notNull(),
    maxActiveStudents: integer("max_active_students").notNull(),
    maxTeamMembers: integer("max_team_members").notNull(),
    billingCycle: text("billing_cycle").notNull(),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("EGP"),
    recommendationPriceMinor: bigint("recommendation_price_minor", { mode: "number" }).notNull(),
    priceDifferenceMinor: bigint("price_difference_minor", { mode: "number" }).notNull(),
    adjustmentReason: text("adjustment_reason"),
    commercialNote: text("commercial_note"),
    effectiveMode: text("effective_mode").notNull().default("IMMEDIATE"),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("PENDING_CUSTOMER"),
    createdByUserId: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by").references(() => users.id, { onDelete: "restrict" }),
    supersedesOfferId: uuid("supersedes_offer_id"),
  },
  (t) => ({
    workspaceStatusIdx: index("custom_plan_offers_workspace_status_idx").on(t.workspaceId, t.status, t.createdAt),
    requestIdx: index("custom_plan_offers_request_idx").on(t.customRequestId),
    requestVersionUnique: unique("custom_plan_offers_request_version_unique").on(t.customRequestId, t.offerVersion),
    onePendingPerRequest: uniqueIndex("custom_plan_offers_one_pending_per_request").on(t.customRequestId).where(sql`status = 'PENDING_CUSTOMER'`),
    studentsCheck: check("custom_plan_offers_students_above_standard_check", sql`${t.maxActiveStudents} > 3000`),
    teamCheck: check("custom_plan_offers_team_nonnegative_check", sql`${t.maxTeamMembers} >= 0`),
    cycleCheck: check("custom_plan_offers_billing_cycle_check", sql`${t.billingCycle} IN ('MONTHLY', 'ANNUAL')`),
    priceCheck: check("custom_plan_offers_price_positive_check", sql`${t.priceMinor} > 0`),
    effectiveModeCheck: check("custom_plan_offers_effective_mode_check", sql`${t.effectiveMode} IN ('IMMEDIATE', 'NEXT_RENEWAL')`),
    statusCheck: check("custom_plan_offers_status_check", sql`${t.status} IN ('PENDING_CUSTOMER', 'ACCEPTED', 'APPLIED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED')`),
    priceReasonCheck: check("custom_plan_offers_price_reason_check", sql`${t.priceDifferenceMinor} = 0 OR ${t.adjustmentReason} IS NOT NULL`),
    acceptProvenanceCheck: check("custom_plan_offers_accept_provenance_check", sql`${t.status} NOT IN ('ACCEPTED', 'APPLIED') OR (${t.acceptedAt} IS NOT NULL AND ${t.acceptedByUserId} IS NOT NULL)`),
  }),
);
