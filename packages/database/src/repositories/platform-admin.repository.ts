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
import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { getDb, getPlatformAdminDb } from "../connection";
import { users } from "../schema/identity";
import { workspaces } from "../schema/workspaces";
import { memberships } from "../schema/permissions";
import { subscriptions, entitlements } from "../schema/subscriptions";
import { platformAdmins, platformAuditEvents } from "../schema/platform-admin";

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
    params.search ? or(ilike(users.fullName, `%${params.search}%`), ilike(users.emailDisplay, `%${params.search}%`)) : undefined,
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
