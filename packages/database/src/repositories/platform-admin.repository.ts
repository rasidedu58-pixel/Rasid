/**
 * Platform Admin repository — Phase 12.
 *
 * Two DIFFERENT connections are used deliberately:
 * - `isPlatformAdmin` runs on `getDb()` (the ordinary `app_runtime`
 *   connection) — checking "is THIS caller a platform admin" is a normal,
 *   narrowly-scoped read any authenticated request can safely make (it
 *   only ever returns a boolean for the caller's OWN id), and doing it on
 *   `app_runtime` means `PlatformAdminGuard` needs no special connection
 *   just to decide whether to grant access.
 * - Every other function here runs on `getPlatformAdminDb()` (the
 *   dedicated `app_platform_admin` connection, see
 *   migrations/0048_platform_admin.sql) — genuinely cross-tenant reads,
 *   only reachable after `isPlatformAdmin` has already confirmed
 *   authorization.
 */
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { getDb, getPlatformAdminDb } from "../connection";
import { users } from "../schema/identity";
import { workspaces } from "../schema/workspaces";
import { memberships } from "../schema/permissions";
import { subscriptions, entitlements } from "../schema/subscriptions";
import { platformAdmins, platformAuditEvents } from "../schema/platform-admin";
import { groups, groupMonths } from "../schema/groups";
import { students } from "../schema/students";
import { operatingMonths } from "../schema/months";
import { sessions } from "../schema/sessions";
import { enrollments } from "../schema/enrollments";
import { auditEvents } from "../schema/audit";

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const rows = await getDb().select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.userId, userId)).limit(1);
  return rows.length > 0;
}

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!iso || !id) return undefined;
    return { createdAt: new Date(iso), id };
  } catch {
    return undefined;
  }
}

const DEFAULT_LIMIT = 30;

export interface ListUsersParams {
  search?: string;
  cursor?: string;
  limit?: number;
}

export async function listUsers(params: ListUsersParams) {
  const db = getPlatformAdminDb();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 100);
  const decoded = decodeCursor(params.cursor);

  const conditions = [
    params.search
      ? or(
          ilike(users.fullName, `%${params.search}%`),
          ilike(users.emailDisplay, `%${params.search}%`),
          ilike(users.phone, `%${params.search}%`),
        )
      : undefined,
    decoded ? or(lt(users.createdAt, decoded.createdAt), and(eq(users.createdAt, decoded.createdAt), lt(users.id, decoded.id))) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      emailDisplay: users.emailDisplay,
      status: users.status,
      createdAt: users.createdAt,
      workspaceCount: sql<number>`count(${memberships.id})`.mapWith(Number),
    })
    .from(users)
    .leftJoin(memberships, eq(memberships.userId, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(users.id)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return {
    items,
    hasNext,
    nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getUserDetail(userId: string) {
  const db = getPlatformAdminDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return undefined;

  const membershipRows = await db
    .select({
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      roleLabel: memberships.roleLabel,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId));

  return { user, memberships: membershipRows };
}

export interface ListWorkspacesParams {
  search?: string;
  state?: string;
  cursor?: string;
  limit?: number;
}

export async function listWorkspaces(params: ListWorkspacesParams) {
  const db = getPlatformAdminDb();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 100);
  const decoded = decodeCursor(params.cursor);
  const owner = users;

  const conditions = [
    params.search ? ilike(workspaces.name, `%${params.search}%`) : undefined,
    params.state ? eq(subscriptions.state, params.state) : undefined,
    decoded ? or(lt(workspaces.createdAt, decoded.createdAt), and(eq(workspaces.createdAt, decoded.createdAt), lt(workspaces.id, decoded.id))) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      ownerUserId: workspaces.ownerUserId,
      ownerName: owner.fullName,
      workspaceType: workspaces.workspaceType,
      status: workspaces.status,
      createdAt: workspaces.createdAt,
      subscriptionState: subscriptions.state,
    })
    .from(workspaces)
    .leftJoin(owner, eq(owner.id, workspaces.ownerUserId))
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(workspaces.createdAt), desc(workspaces.id))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return {
    items,
    hasNext,
    nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getWorkspaceDetail(workspaceId: string) {
  const db = getPlatformAdminDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) return undefined;

  const [owner] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, workspace.ownerUserId)).limit(1);

  const memberRows = await db
    .select({
      userId: users.id,
      fullName: users.fullName,
      emailDisplay: users.emailDisplay,
      roleLabel: memberships.roleLabel,
      status: memberships.status,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId));

  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);

  const entitlementRows = await db
    .select({ capability: entitlements.capability, state: entitlements.state })
    .from(entitlements)
    .where(and(eq(entitlements.workspaceId, workspaceId), sql`${entitlements.effectiveTo} IS NULL`));

  return { workspace, ownerName: owner?.fullName ?? null, members: memberRows, subscription, entitlements: entitlementRows };
}

export interface ListSubscriptionsParams {
  state?: string;
  cursor?: string;
  limit?: number;
}

export async function listSubscriptions(params: ListSubscriptionsParams) {
  const db = getPlatformAdminDb();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 100);
  const decoded = decodeCursor(params.cursor);

  const conditions = [
    params.state ? eq(subscriptions.state, params.state) : undefined,
    decoded ? or(lt(subscriptions.createdAt, decoded.createdAt), and(eq(subscriptions.createdAt, decoded.createdAt), lt(subscriptions.id, decoded.id))) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: subscriptions.id,
      workspaceId: subscriptions.workspaceId,
      workspaceName: workspaces.name,
      provider: subscriptions.provider,
      state: subscriptions.state,
      periodStart: subscriptions.periodStart,
      periodEnd: subscriptions.periodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      createdAt: subscriptions.createdAt,
    })
    .from(subscriptions)
    .innerJoin(workspaces, eq(workspaces.id, subscriptions.workspaceId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return {
    items,
    hasNext,
    nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getDashboardStats() {
  const db = getPlatformAdminDb();

  const [totalUsersRows, totalWorkspacesRows, stateRows, recentSignupRows, expiringRows] = await Promise.all([
    db.select({ totalUsers: sql<number>`count(*)`.mapWith(Number) }).from(users),
    db.select({ totalWorkspaces: sql<number>`count(*)`.mapWith(Number) }).from(workspaces),
    db.select({ state: subscriptions.state, count: sql<number>`count(*)`.mapWith(Number) }).from(subscriptions).groupBy(subscriptions.state),
    db
      .select({ workspaceId: workspaces.id, name: workspaces.name, ownerName: users.fullName, createdAt: workspaces.createdAt })
      .from(workspaces)
      .leftJoin(users, eq(users.id, workspaces.ownerUserId))
      .orderBy(desc(workspaces.createdAt))
      .limit(10),
    db
      .select({ expiringWithin7Days: sql<number>`count(*)`.mapWith(Number) })
      .from(subscriptions)
      .where(
        and(
          sql`${subscriptions.state} IN ('TRIAL', 'CANCELLED_AT_PERIOD_END')`,
          gte(subscriptions.periodEnd, new Date()),
          lt(subscriptions.periodEnd, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
        ),
      ),
  ]);

  const subscriptionsByState: Record<string, number> = {};
  for (const row of stateRows) subscriptionsByState[row.state] = row.count;

  return {
    totalUsers: totalUsersRows[0]?.totalUsers ?? 0,
    totalWorkspaces: totalWorkspacesRows[0]?.totalWorkspaces ?? 0,
    subscriptionsByState,
    recentSignups: recentSignupRows,
    expiringWithin7Days: expiringRows[0]?.expiringWithin7Days ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Phase C — read-only operational snapshot / needs-attention / activity.
// The operational reads degrade gracefully: until 0055 grants app_platform_admin
// SELECT on the operational tables, those queries raise "permission denied" and
// we return `available:false` rather than 500 — the console still shows
// identity/subscription, and the operational panel lights up once 0055 is applied.
// ---------------------------------------------------------------------------

export interface WorkspaceOperationalSnapshot {
  available: boolean;
  currentMonth: { id: string; year: number; month: number; status: string } | null;
  groupsCount: number | null;
  studentsCount: number | null;
  activeEnrollmentsCount: number | null;
  sessionsThisMonth: { total: number; completed: number } | null;
  lastActivityAt: Date | null;
}

export async function getWorkspaceOperationalSnapshot(workspaceId: string): Promise<WorkspaceOperationalSnapshot> {
  const db = getPlatformAdminDb();
  const unavailable: WorkspaceOperationalSnapshot = {
    available: false,
    currentMonth: null,
    groupsCount: null,
    studentsCount: null,
    activeEnrollmentsCount: null,
    sessionsThisMonth: null,
    lastActivityAt: null,
  };
  try {
    // Run inside a transaction that sets `app.workspace_id` to the target
    // workspace, so the operational tables' tenant-isolation RLS policies
    // evaluate cleanly (scoped to this workspace) instead of throwing on an
    // unset context — the 0055 SELECT grants provide the table privilege, this
    // provides the row scope. If the grants aren't applied yet, the reads still
    // fail and we degrade to `available:false` (never a 500).
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);

      const [current] = await tx
        .select({ id: operatingMonths.id, year: operatingMonths.year, month: operatingMonths.month, status: operatingMonths.status })
        .from(operatingMonths)
        .where(and(eq(operatingMonths.workspaceId, workspaceId), eq(operatingMonths.status, "CURRENT")))
        .limit(1);

      const [groupsRow] = await tx
        .select({ c: sql<number>`count(*)`.mapWith(Number) })
        .from(groups)
        .where(and(eq(groups.workspaceId, workspaceId), eq(groups.status, "ACTIVE")));
      const [studentsRow] = await tx
        .select({ c: sql<number>`count(*)`.mapWith(Number) })
        .from(students)
        .where(and(eq(students.workspaceId, workspaceId), eq(students.status, "ACTIVE")));
      const [enrollRow] = await tx
        .select({ c: sql<number>`count(*)`.mapWith(Number) })
        .from(enrollments)
        .where(and(eq(enrollments.workspaceId, workspaceId), eq(enrollments.status, "ACTIVE")));

      let sessionsThisMonth: { total: number; completed: number } | null = null;
      if (current) {
        const [sessRow] = await tx
          .select({
            total: sql<number>`count(*)`.mapWith(Number),
            completed: sql<number>`count(*) filter (where ${sessions.status} = 'COMPLETED')`.mapWith(Number),
          })
          .from(sessions)
          .innerJoin(groupMonths, eq(groupMonths.id, sessions.groupMonthId))
          .where(and(eq(groupMonths.workspaceId, workspaceId), eq(groupMonths.operatingMonthId, current.id)));
        sessionsThisMonth = { total: sessRow?.total ?? 0, completed: sessRow?.completed ?? 0 };
      }

      const [activityRow] = await tx
        .select({ last: sql<string | null>`max(${auditEvents.createdAt})` })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspaceId));

      // `max(...)` is a raw SQL aggregate, so drizzle applies no column codec —
      // the value arrives as whatever postgres.js yields (a timestamp string),
      // NOT a Date. Coerce explicitly so the caller can safely `.toISOString()`.
      const lastActivityAt = activityRow?.last ? new Date(activityRow.last) : null;

      return {
        available: true,
        currentMonth: current ?? null,
        groupsCount: groupsRow?.c ?? 0,
        studentsCount: studentsRow?.c ?? 0,
        activeEnrollmentsCount: enrollRow?.c ?? 0,
        sessionsThisMonth,
        lastActivityAt,
      };
    });
  } catch {
    // Reads not permitted (grants missing) or RLS blocked — degrade, never 500.
    return unavailable;
  }
}

export interface PlatformAttentionRow {
  workspaceId: string;
  workspaceName: string;
  ownerName: string | null;
  state: string;
  periodEnd: Date | null;
}

async function listSubscriptionsByStates(states: string[], order: "asc" | "desc", limit: number): Promise<PlatformAttentionRow[]> {
  const db = getPlatformAdminDb();
  return db
    .select({
      workspaceId: subscriptions.workspaceId,
      workspaceName: workspaces.name,
      ownerName: users.fullName,
      state: subscriptions.state,
      periodEnd: subscriptions.periodEnd,
    })
    .from(subscriptions)
    .innerJoin(workspaces, eq(workspaces.id, subscriptions.workspaceId))
    .leftJoin(users, eq(users.id, workspaces.ownerUserId))
    .where(inArray(subscriptions.state, states))
    .orderBy(order === "asc" ? asc(subscriptions.periodEnd) : desc(subscriptions.periodEnd))
    .limit(limit);
}

export async function getNeedsAttention(): Promise<{ trialsExpiringSoon: PlatformAttentionRow[]; expired: PlatformAttentionRow[]; paymentFailed: PlatformAttentionRow[] }> {
  const db = getPlatformAdminDb();
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [trialsExpiringSoon, expired, paymentFailed] = await Promise.all([
    db
      .select({
        workspaceId: subscriptions.workspaceId,
        workspaceName: workspaces.name,
        ownerName: users.fullName,
        state: subscriptions.state,
        periodEnd: subscriptions.periodEnd,
      })
      .from(subscriptions)
      .innerJoin(workspaces, eq(workspaces.id, subscriptions.workspaceId))
      .leftJoin(users, eq(users.id, workspaces.ownerUserId))
      .where(
        and(
          inArray(subscriptions.state, ["TRIAL", "CANCELLED_AT_PERIOD_END"]),
          gte(subscriptions.periodEnd, now),
          lt(subscriptions.periodEnd, in7),
        ),
      )
      .orderBy(asc(subscriptions.periodEnd))
      .limit(20),
    listSubscriptionsByStates(["EXPIRED"], "desc", 20),
    listSubscriptionsByStates(["PAYMENT_FAILED"], "desc", 20),
  ]);
  return { trialsExpiringSoon, expired, paymentFailed };
}

export interface PlatformActivityRow {
  kind: "workspace.created" | "subscription.state_changed";
  at: Date;
  workspaceId: string | null;
  workspaceName: string | null;
  label: string;
  detail: string | null;
}

export async function getPlatformActivity(): Promise<{ items: PlatformActivityRow[]; available: boolean }> {
  const db = getPlatformAdminDb();
  // Signups are always readable (workspaces granted since 0048).
  const signups = await db
    .select({ id: workspaces.id, name: workspaces.name, createdAt: workspaces.createdAt })
    .from(workspaces)
    .orderBy(desc(workspaces.createdAt))
    .limit(20);
  const items: PlatformActivityRow[] = signups.map((w) => ({
    kind: "workspace.created" as const,
    at: w.createdAt,
    workspaceId: w.id,
    workspaceName: w.name,
    label: "مساحة عمل جديدة",
    detail: null,
  }));

  let available = true;
  try {
    // Subscription state changes come from tenant audit_events (needs 0055).
    const changes = await db
      .select({
        at: auditEvents.createdAt,
        workspaceId: auditEvents.workspaceId,
        workspaceName: workspaces.name,
        afterJson: auditEvents.afterJson,
      })
      .from(auditEvents)
      .leftJoin(workspaces, eq(workspaces.id, auditEvents.workspaceId))
      .where(eq(auditEvents.action, "subscription.state_changed"))
      .orderBy(desc(auditEvents.createdAt))
      .limit(20);
    for (const c of changes) {
      const nextState = (c.afterJson as { state?: string } | null)?.state ?? null;
      items.push({
        kind: "subscription.state_changed",
        at: c.at,
        workspaceId: c.workspaceId,
        workspaceName: c.workspaceName ?? null,
        label: "تغيّر حالة الاشتراك",
        detail: nextState,
      });
    }
  } catch {
    available = false; // audit_events not yet granted (0055 pending)
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items: items.slice(0, 30), available };
}

export interface InsertPlatformAuditEventInput {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetWorkspaceId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  reason?: string;
  correlationId?: string;
}

export async function insertPlatformAuditEvent(input: InsertPlatformAuditEventInput): Promise<void> {
  await getPlatformAdminDb().insert(platformAuditEvents).values({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    targetWorkspaceId: input.targetWorkspaceId ?? null,
    beforeJson: input.beforeJson ?? null,
    afterJson: input.afterJson ?? null,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? null,
  });
}
