/**
 * Platform Leads repository — Phase 16 Part B.
 *
 * Two access paths, two roles (mirrors the split in
 * platform-operations.repository.ts):
 *   - `insertLeadForNewWorkspaceTx` runs INSIDE the signup/provisioning
 *     transaction as `app_runtime` — it is the ONLY writer on that path and is
 *     idempotent (ON CONFLICT (workspace_id) DO NOTHING), so a retried or
 *     racing provision never creates a duplicate lead. No backfill exists:
 *     leads accrue only from signups after this ships.
 *   - the console reads/updates run on `getPlatformAdminDb()`
 *     (`app_platform_admin`), only reachable after the platform guards.
 *
 * NO PII is stored on the lead row. Name / phone / email and the subscription
 * hint are LEFT-JOINed live at read time (users + subscriptions). An active
 * paid subscription is surfaced as a boolean hint only — it never flips the
 * lead's status (CONVERTED is manual in V1).
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getPlatformAdminDb } from "../connection";
import { users } from "../schema/identity";
import { workspaces } from "../schema/workspaces";
import { subscriptions } from "../schema/subscriptions";
import { platformLeads, platformAuditEvents } from "../schema/platform-admin";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const LEAD_OPEN_STATUSES = ["NEW", "CONTACTED", "FOLLOW_UP", "POSTPONED"] as const;

// The platform admin who last edited the lead — aliased so it can be joined
// alongside the lead OWNER (`users`) in the same query without a name clash.
const editorUser = alias(users, "editor");

// A Drizzle transaction handle, derived from the real connection so the signup
// hook stays typed without a bare `any` (same technique as
// platform-operations.repository's `Tx`). The identity provisioning tx (from
// getDb()/app_runtime) is structurally the same PostgresJsDatabase tx type.
type LeadTx = Parameters<Parameters<ReturnType<typeof getPlatformAdminDb>["transaction"]>[0]>[0];

/** A lead row joined to its owner's live identity + subscription hint. */
export interface PlatformLeadRow {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  ownerUserId: string;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  status: string;
  lastContactAt: Date | null;
  nextFollowUpAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  updatedByName: string | null;
  subscriptionState: string | null;
  subscriptionPlanCode: string | null;
  trialEndsAt: Date | null;
}

/**
 * Create the lead for a freshly-provisioned owner workspace. Called from the
 * identity provisioning transaction (same tx = atomic with the workspace),
 * running as `app_runtime`. Idempotent on `workspace_id`.
 */
export async function insertLeadForNewWorkspaceTx(
  tx: LeadTx,
  input: { workspaceId: string; ownerUserId: string },
): Promise<void> {
  await tx
    .insert(platformLeads)
    .values({ workspaceId: input.workspaceId, ownerUserId: input.ownerUserId, status: "NEW" })
    .onConflictDoNothing({ target: platformLeads.workspaceId });
}

export interface ListPlatformLeadsParams {
  statuses?: readonly string[];
  needsFollowUp?: boolean; // FOLLOW_UP OR an overdue next_follow_up_at (open leads)
  search?: string; // matches owner name / phone / email (case-insensitive)
  limit?: number;
}

/**
 * List leads in working-priority order:
 *   1. follow-up OVERDUE (open lead, next_follow_up_at in the past)
 *   2. NEW (never contacted)
 *   3. follow-up DUE TODAY
 *   4. everything else
 * then, within a bucket, earliest follow-up first, newest signup first.
 *
 * V1 returns a single prioritized page (no cursor) — pilot lead volume is
 * small and the metrics strip carries the true totals; `hasNext` reflects
 * whether the cap truncated the set so the UI can hint "refine with filters".
 */
export async function listPlatformLeads(
  params: ListPlatformLeadsParams,
): Promise<{ items: PlatformLeadRow[]; hasNext: boolean }> {
  const db = getPlatformAdminDb();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const overdue = sql`${platformLeads.nextFollowUpAt} IS NOT NULL AND ${platformLeads.nextFollowUpAt} < now() AND ${platformLeads.status} IN ('NEW','CONTACTED','FOLLOW_UP','POSTPONED')`;

  const conditions = [
    params.statuses && params.statuses.length
      ? sql`${platformLeads.status} IN (${sql.join(params.statuses.map((s) => sql`${s}`), sql`, `)})`
      : undefined,
    params.needsFollowUp ? sql`(${platformLeads.status} = 'FOLLOW_UP' OR (${overdue}))` : undefined,
    params.search && params.search.trim()
      ? or(
          ilike(users.fullName, `%${params.search.trim()}%`),
          ilike(users.phone, `%${params.search.trim()}%`),
          ilike(users.emailDisplay, `%${params.search.trim()}%`),
        )
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const priority = sql<number>`CASE
      WHEN ${overdue} THEN 0
      WHEN ${platformLeads.status} = 'NEW' THEN 1
      WHEN ${platformLeads.nextFollowUpAt} IS NOT NULL
        AND date_trunc('day', ${platformLeads.nextFollowUpAt} AT TIME ZONE 'UTC') = date_trunc('day', now() AT TIME ZONE 'UTC') THEN 2
      ELSE 3
    END`;

  const rows = await db
    .select({
      id: platformLeads.id,
      workspaceId: platformLeads.workspaceId,
      workspaceName: workspaces.name,
      ownerUserId: platformLeads.ownerUserId,
      ownerName: users.fullName,
      ownerPhone: users.phone,
      ownerEmail: users.emailDisplay,
      status: platformLeads.status,
      lastContactAt: platformLeads.lastContactAt,
      nextFollowUpAt: platformLeads.nextFollowUpAt,
      note: platformLeads.note,
      createdAt: platformLeads.createdAt,
      updatedAt: platformLeads.updatedAt,
      updatedByName: editorUser.fullName,
      subscriptionState: subscriptions.state,
      subscriptionPlanCode: subscriptions.planCode,
      trialEndsAt: subscriptions.periodEnd,
      priority,
    })
    .from(platformLeads)
    .leftJoin(users, eq(users.id, platformLeads.ownerUserId))
    .leftJoin(workspaces, eq(workspaces.id, platformLeads.workspaceId))
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, platformLeads.workspaceId))
    .leftJoin(editorUser, eq(editorUser.id, platformLeads.updatedBy))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      priority,
      sql`${platformLeads.nextFollowUpAt} ASC NULLS LAST`,
      desc(platformLeads.createdAt),
      desc(platformLeads.id),
    )
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit).map(({ priority: _p, ...r }) => r);
  return { items, hasNext };
}

export interface PlatformLeadMetrics {
  total: number;
  newCount: number;
  needsFollowUp: number;
  dueToday: number;
  converted: number;
}

/** Aggregate counts for the metrics strip (true totals, unaffected by filters). */
export async function getPlatformLeadMetrics(): Promise<PlatformLeadMetrics> {
  const db = getPlatformAdminDb();
  const openList = sql.join(LEAD_OPEN_STATUSES.map((s) => sql`${s}`), sql`, `);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      newCount: sql<number>`count(*) FILTER (WHERE ${platformLeads.status} = 'NEW')::int`,
      needsFollowUp: sql<number>`count(*) FILTER (WHERE ${platformLeads.status} = 'FOLLOW_UP' OR (${platformLeads.nextFollowUpAt} IS NOT NULL AND ${platformLeads.nextFollowUpAt} < now() AND ${platformLeads.status} IN (${openList})))::int`,
      dueToday: sql<number>`count(*) FILTER (WHERE ${platformLeads.nextFollowUpAt} IS NOT NULL AND date_trunc('day', ${platformLeads.nextFollowUpAt} AT TIME ZONE 'UTC') = date_trunc('day', now() AT TIME ZONE 'UTC') AND ${platformLeads.status} IN (${openList}))::int`,
      converted: sql<number>`count(*) FILTER (WHERE ${platformLeads.status} = 'CONVERTED')::int`,
    })
    .from(platformLeads);
  return (
    row ?? { total: 0, newCount: 0, needsFollowUp: 0, dueToday: 0, converted: 0 }
  );
}

/** Load one lead (joined) by id — used to return the fresh state after an update. */
export async function getPlatformLeadById(id: string): Promise<PlatformLeadRow | null> {
  const db = getPlatformAdminDb();
  const rows = await db
    .select({
      id: platformLeads.id,
      workspaceId: platformLeads.workspaceId,
      workspaceName: workspaces.name,
      ownerUserId: platformLeads.ownerUserId,
      ownerName: users.fullName,
      ownerPhone: users.phone,
      ownerEmail: users.emailDisplay,
      status: platformLeads.status,
      lastContactAt: platformLeads.lastContactAt,
      nextFollowUpAt: platformLeads.nextFollowUpAt,
      note: platformLeads.note,
      createdAt: platformLeads.createdAt,
      updatedAt: platformLeads.updatedAt,
      updatedByName: editorUser.fullName,
      subscriptionState: subscriptions.state,
      subscriptionPlanCode: subscriptions.planCode,
      trialEndsAt: subscriptions.periodEnd,
    })
    .from(platformLeads)
    .leftJoin(users, eq(users.id, platformLeads.ownerUserId))
    .leftJoin(workspaces, eq(workspaces.id, platformLeads.workspaceId))
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, platformLeads.workspaceId))
    .leftJoin(editorUser, eq(editorUser.id, platformLeads.updatedBy))
    .where(eq(platformLeads.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpdatePlatformLeadInput {
  id: string;
  actorUserId: string;
  status?: string;
  note?: string | null;
  nextFollowUpAt?: Date | null;
  markContactedNow?: boolean;
}

/**
 * Apply a follow-up edit to a lead and append a platform audit event in the
 * SAME transaction. Returns the fresh joined row, or null if the lead doesn't
 * exist. Only the follow-up columns are writable (matches the migration's
 * column-scoped UPDATE grant); identity/subscription fields are never touched.
 */
export async function updatePlatformLead(input: UpdatePlatformLeadInput): Promise<PlatformLeadRow | null> {
  const db = getPlatformAdminDb();
  const updatedId = await db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        status: platformLeads.status,
        note: platformLeads.note,
        nextFollowUpAt: platformLeads.nextFollowUpAt,
        lastContactAt: platformLeads.lastContactAt,
        workspaceId: platformLeads.workspaceId,
      })
      .from(platformLeads)
      .where(eq(platformLeads.id, input.id))
      .limit(1);
    if (!before) return null;

    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: input.actorUserId };
    if (input.status !== undefined) patch.status = input.status;
    if (input.note !== undefined) patch.note = input.note;
    if (input.nextFollowUpAt !== undefined) patch.nextFollowUpAt = input.nextFollowUpAt;
    if (input.markContactedNow) patch.lastContactAt = new Date();

    const [after] = await tx
      .update(platformLeads)
      .set(patch)
      .where(eq(platformLeads.id, input.id))
      .returning({
        status: platformLeads.status,
        note: platformLeads.note,
        nextFollowUpAt: platformLeads.nextFollowUpAt,
        lastContactAt: platformLeads.lastContactAt,
      });

    await tx.insert(platformAuditEvents).values({
      actorUserId: input.actorUserId,
      action: "platform.lead.updated",
      targetType: "platform_lead",
      targetId: input.id,
      targetWorkspaceId: before.workspaceId,
      beforeJson: before,
      afterJson: after ?? null,
    });
    return input.id;
  });

  if (!updatedId) return null;
  return getPlatformLeadById(updatedId);
}
