/**
 * Platform Operations repository — RBAC + Unit 1 (Customer Communication +
 * Follow-up). Reads/writes on PLATFORM tables only (never tenant data).
 *
 * Connections, same split rationale as platform-admin.repository.ts:
 * - `getPlatformAdminRole` runs on `getDb()` (`app_runtime`) — the guard needs
 *   the caller's OWN role to authorize, exactly like `isPlatformAdmin`.
 * - Every list/write runs on `getPlatformAdminDb()` (`app_platform_admin`),
 *   only reachable after the guard has already confirmed authorization.
 *
 * Every write appends a `platform_audit_events` row inside the same
 * transaction — the platform console is now an accountable actor.
 */
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, getPlatformAdminDb } from "../connection";
import { users } from "../schema/identity";
import { workspaces } from "../schema/workspaces";
import { platformAdmins, platformContactLogs, platformFollowUps, platformAuditEvents, platformOperatingMonthOverrides } from "../schema/platform-admin";

// Local to avoid a database→contracts package dependency; the string values are
// the single source of truth in migration 0056's CHECK constraint.
export type PlatformRole = "PLATFORM_OWNER" | "OPERATIONS_ADMIN" | "SUPPORT_AGENT";
const PLATFORM_ROLES = ["PLATFORM_OWNER", "OPERATIONS_ADMIN", "SUPPORT_AGENT"] as const;
function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

/**
 * The caller's own platform role, or null if they are not on the allowlist.
 * Runs on `app_runtime` (like `isPlatformAdmin`) — a narrow read of the
 * caller's own row that the auth guard makes before granting access.
 */
export async function getPlatformAdminRole(userId: string): Promise<PlatformRole | null> {
  const rows = await getDb()
    .select({ role: platformAdmins.role })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  const role = rows[0]?.role;
  return role && isPlatformRole(role) ? role : role ? "SUPPORT_AGENT" : null;
}

const DEFAULT_LIMIT = 30;

function encodeCursor(ts: Date, id: string): string {
  return Buffer.from(`${ts.toISOString()}|${id}`, "utf8").toString("base64url");
}
function decodeCursor(cursor: string | undefined): { ts: Date; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!iso || !id) return undefined;
    return { ts: new Date(iso), id };
  } catch {
    return undefined;
  }
}

// --- Platform staff (for follow-up assignment + role display) ---------------
// MINIMUM-NECESSARY only: userId + display name + role. Deliberately NO email /
// phone / other PII — this endpoint exists solely to populate an assignment
// picker. A full staff-management view (if ever built) would be a separate
// endpoint behind platform.staff.manage, not this one.
export async function listPlatformStaff(): Promise<Array<{ userId: string; fullName: string; role: PlatformRole }>> {
  const rows = await getPlatformAdminDb()
    .select({ userId: platformAdmins.userId, fullName: users.fullName, role: platformAdmins.role })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .orderBy(users.fullName);
  return rows.map((r) => ({ userId: r.userId, fullName: r.fullName, role: isPlatformRole(r.role) ? r.role : "SUPPORT_AGENT" }));
}

// --- Audit helper -----------------------------------------------------------
type Tx = Parameters<Parameters<ReturnType<typeof getPlatformAdminDb>["transaction"]>[0]>[0];
async function writeAudit(
  tx: Tx,
  params: { actorUserId: string; action: string; targetType: string; targetId?: string | null; targetWorkspaceId?: string | null; afterJson?: unknown },
): Promise<void> {
  await tx.insert(platformAuditEvents).values({
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    targetWorkspaceId: params.targetWorkspaceId ?? null,
    afterJson: (params.afterJson ?? null) as never,
  });
}

// --- Contact logs -----------------------------------------------------------
export interface PlatformContactLogRow {
  id: string;
  workspaceId: string;
  channel: string;
  direction: string;
  summary: string;
  occurredAt: Date;
  createdAt: Date;
  createdByUserId: string | null;
  createdByName: string | null;
}

export async function listContactLogs(params: { workspaceId: string; cursor?: string; limit?: number }): Promise<{ items: PlatformContactLogRow[]; nextCursor: string | null; hasNext: boolean }> {
  const db = getPlatformAdminDb();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 100);
  const decoded = decodeCursor(params.cursor);
  const conditions = [
    eq(platformContactLogs.workspaceId, params.workspaceId),
    decoded
      ? or(lt(platformContactLogs.occurredAt, decoded.ts), and(eq(platformContactLogs.occurredAt, decoded.ts), lt(platformContactLogs.id, decoded.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: platformContactLogs.id,
      workspaceId: platformContactLogs.workspaceId,
      channel: platformContactLogs.channel,
      direction: platformContactLogs.direction,
      summary: platformContactLogs.summary,
      occurredAt: platformContactLogs.occurredAt,
      createdAt: platformContactLogs.createdAt,
      createdByUserId: platformContactLogs.createdByUserId,
      createdByName: users.fullName,
    })
    .from(platformContactLogs)
    .leftJoin(users, eq(users.id, platformContactLogs.createdByUserId))
    .where(and(...conditions))
    .orderBy(desc(platformContactLogs.occurredAt), desc(platformContactLogs.id))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasNext && last ? encodeCursor(last.occurredAt, last.id) : null, hasNext };
}

export async function createContactLog(params: {
  workspaceId: string;
  channel: string;
  direction: string;
  summary: string;
  occurredAt?: Date;
  actorUserId: string;
}): Promise<PlatformContactLogRow> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(platformContactLogs)
      .values({
        workspaceId: params.workspaceId,
        channel: params.channel,
        direction: params.direction,
        summary: params.summary,
        occurredAt: params.occurredAt ?? new Date(),
        createdByUserId: params.actorUserId,
      })
      .returning();
    if (!row) throw new Error("failed to insert platform contact log");
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.contact_log.created",
      targetType: "platform_contact_log",
      targetId: row.id,
      targetWorkspaceId: params.workspaceId,
      afterJson: { channel: params.channel, direction: params.direction },
    });
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      channel: row.channel,
      direction: row.direction,
      summary: row.summary,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      createdByUserId: row.createdByUserId,
      createdByName: null,
    };
  });
}

// --- Follow-ups -------------------------------------------------------------
export interface FollowUpRow {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  title: string;
  note: string | null;
  dueAt: Date | null;
  status: string;
  createdAt: Date;
  createdByUserId: string | null;
  createdByName: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  resolvedAt: Date | null;
  resolvedByName: string | null;
}

const createdByUser = alias(users, "created_by_user");
const assignedToUser = alias(users, "assigned_to_user");
const resolvedByUser = alias(users, "resolved_by_user");

export async function listFollowUps(params: {
  workspaceId?: string;
  status?: string;
  assignedToUserId?: string;
  cursor?: string;
  limit?: number;
}): Promise<{ items: FollowUpRow[]; nextCursor: string | null; hasNext: boolean }> {
  const db = getPlatformAdminDb();
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 100);
  const decoded = decodeCursor(params.cursor);
  const conditions = [
    params.workspaceId ? eq(platformFollowUps.workspaceId, params.workspaceId) : undefined,
    params.status ? eq(platformFollowUps.status, params.status) : undefined,
    params.assignedToUserId ? eq(platformFollowUps.assignedToUserId, params.assignedToUserId) : undefined,
    decoded
      ? or(lt(platformFollowUps.createdAt, decoded.ts), and(eq(platformFollowUps.createdAt, decoded.ts), lt(platformFollowUps.id, decoded.id)))
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const rows = await db
    .select({
      id: platformFollowUps.id,
      workspaceId: platformFollowUps.workspaceId,
      workspaceName: workspaces.name,
      title: platformFollowUps.title,
      note: platformFollowUps.note,
      dueAt: platformFollowUps.dueAt,
      status: platformFollowUps.status,
      createdAt: platformFollowUps.createdAt,
      createdByUserId: platformFollowUps.createdByUserId,
      createdByName: createdByUser.fullName,
      assignedToUserId: platformFollowUps.assignedToUserId,
      assignedToName: assignedToUser.fullName,
      resolvedAt: platformFollowUps.resolvedAt,
      resolvedByName: resolvedByUser.fullName,
    })
    .from(platformFollowUps)
    .leftJoin(workspaces, eq(workspaces.id, platformFollowUps.workspaceId))
    .leftJoin(createdByUser, eq(createdByUser.id, platformFollowUps.createdByUserId))
    .leftJoin(assignedToUser, eq(assignedToUser.id, platformFollowUps.assignedToUserId))
    .leftJoin(resolvedByUser, eq(resolvedByUser.id, platformFollowUps.resolvedByUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(platformFollowUps.createdAt), desc(platformFollowUps.id))
    .limit(limit + 1);

  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: hasNext && last ? encodeCursor(last.createdAt, last.id) : null, hasNext };
}

/** Single enriched follow-up (with all display names), or null. */
export async function getFollowUpById(id: string): Promise<FollowUpRow | null> {
  const rows = await getPlatformAdminDb()
    .select({
      id: platformFollowUps.id,
      workspaceId: platformFollowUps.workspaceId,
      workspaceName: workspaces.name,
      title: platformFollowUps.title,
      note: platformFollowUps.note,
      dueAt: platformFollowUps.dueAt,
      status: platformFollowUps.status,
      createdAt: platformFollowUps.createdAt,
      createdByUserId: platformFollowUps.createdByUserId,
      createdByName: createdByUser.fullName,
      assignedToUserId: platformFollowUps.assignedToUserId,
      assignedToName: assignedToUser.fullName,
      resolvedAt: platformFollowUps.resolvedAt,
      resolvedByName: resolvedByUser.fullName,
    })
    .from(platformFollowUps)
    .leftJoin(workspaces, eq(workspaces.id, platformFollowUps.workspaceId))
    .leftJoin(createdByUser, eq(createdByUser.id, platformFollowUps.createdByUserId))
    .leftJoin(assignedToUser, eq(assignedToUser.id, platformFollowUps.assignedToUserId))
    .leftJoin(resolvedByUser, eq(resolvedByUser.id, platformFollowUps.resolvedByUserId))
    .where(eq(platformFollowUps.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createFollowUp(params: {
  workspaceId: string;
  title: string;
  note?: string | null;
  dueAt?: Date | null;
  assignedToUserId?: string | null;
  actorUserId: string;
}): Promise<{ id: string }> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(platformFollowUps)
      .values({
        workspaceId: params.workspaceId,
        title: params.title,
        note: params.note ?? null,
        dueAt: params.dueAt ?? null,
        assignedToUserId: params.assignedToUserId ?? null,
        createdByUserId: params.actorUserId,
      })
      .returning({ id: platformFollowUps.id });
    if (!row) throw new Error("failed to insert platform follow-up");
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.follow_up.created",
      targetType: "platform_follow_up",
      targetId: row.id,
      targetWorkspaceId: params.workspaceId,
      afterJson: { title: params.title, assignedToUserId: params.assignedToUserId ?? null },
    });
    return { id: row.id };
  });
}

/**
 * Resolve / cancel / reassign / reschedule a follow-up. Returns null if the id
 * does not exist. Setting status to DONE/CANCELLED stamps resolvedAt/resolvedBy.
 */
export async function updateFollowUp(params: {
  id: string;
  status?: "DONE" | "CANCELLED";
  assignedToUserId?: string | null;
  dueAt?: Date | null;
  actorUserId: string;
}): Promise<{ id: string; workspaceId: string; status: string } | null> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const patch: Record<string, unknown> = {};
    if (params.status !== undefined) {
      patch.status = params.status;
      patch.resolvedAt = new Date();
      patch.resolvedByUserId = params.actorUserId;
    }
    if (params.assignedToUserId !== undefined) patch.assignedToUserId = params.assignedToUserId;
    if (params.dueAt !== undefined) patch.dueAt = params.dueAt;
    if (Object.keys(patch).length === 0) {
      const [cur] = await tx
        .select({ id: platformFollowUps.id, workspaceId: platformFollowUps.workspaceId, status: platformFollowUps.status })
        .from(platformFollowUps)
        .where(eq(platformFollowUps.id, params.id))
        .limit(1);
      return cur ?? null;
    }
    const [row] = await tx
      .update(platformFollowUps)
      .set(patch)
      .where(eq(platformFollowUps.id, params.id))
      .returning({ id: platformFollowUps.id, workspaceId: platformFollowUps.workspaceId, status: platformFollowUps.status });
    if (!row) return null;
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.follow_up.updated",
      targetType: "platform_follow_up",
      targetId: row.id,
      targetWorkspaceId: row.workspaceId,
      afterJson: patch,
    });
    return row;
  });
}

// --- Operating-Month Overrides (Platform Ops writes) ------------------------
export type MonthOverrideType = "EARLY_PREP_ALLOWED" | "PREP_BLOCKED";

export interface MonthOverrideRow {
  id: string;
  workspaceId: string;
  type: string;
  reason: string;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedByName: string | null;
  active: boolean;
}

const ovCreatedBy = alias(users, "ov_created_by");
const ovRevokedBy = alias(users, "ov_revoked_by");

/** Full override history for one workspace (Customer 360), newest first. */
export async function listMonthOverridesForWorkspace(workspaceId: string): Promise<MonthOverrideRow[]> {
  const rows = await getPlatformAdminDb()
    .select({
      id: platformOperatingMonthOverrides.id,
      workspaceId: platformOperatingMonthOverrides.workspaceId,
      type: platformOperatingMonthOverrides.type,
      reason: platformOperatingMonthOverrides.reason,
      createdByUserId: platformOperatingMonthOverrides.createdByUserId,
      createdByName: ovCreatedBy.fullName,
      createdAt: platformOperatingMonthOverrides.createdAt,
      expiresAt: platformOperatingMonthOverrides.expiresAt,
      revokedAt: platformOperatingMonthOverrides.revokedAt,
      revokedByName: ovRevokedBy.fullName,
    })
    .from(platformOperatingMonthOverrides)
    .leftJoin(ovCreatedBy, eq(ovCreatedBy.id, platformOperatingMonthOverrides.createdByUserId))
    .leftJoin(ovRevokedBy, eq(ovRevokedBy.id, platformOperatingMonthOverrides.revokedByUserId))
    .where(eq(platformOperatingMonthOverrides.workspaceId, workspaceId))
    .orderBy(desc(platformOperatingMonthOverrides.createdAt))
    .limit(50);
  const now = Date.now();
  return rows.map((r) => ({
    ...r,
    active: r.revokedAt === null && (r.expiresAt === null || r.expiresAt.getTime() > now),
  }));
}

/**
 * Grant an override. Transactional: revoke any existing NON-revoked row of the
 * same type first (including expired-but-unrevoked, so the partial unique index
 * on (workspace_id, type) WHERE revoked_at IS NULL never conflicts), then insert
 * the new one, then append a platform audit event.
 */
export async function createMonthOverride(params: {
  workspaceId: string;
  type: MonthOverrideType;
  reason: string;
  expiresAt?: Date | null;
  actorUserId: string;
}): Promise<{ id: string }> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    await tx
      .update(platformOperatingMonthOverrides)
      .set({ revokedAt: new Date(), revokedByUserId: params.actorUserId })
      .where(
        and(
          eq(platformOperatingMonthOverrides.workspaceId, params.workspaceId),
          eq(platformOperatingMonthOverrides.type, params.type),
          isNull(platformOperatingMonthOverrides.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(platformOperatingMonthOverrides)
      .values({
        workspaceId: params.workspaceId,
        type: params.type,
        reason: params.reason,
        expiresAt: params.expiresAt ?? null,
        createdByUserId: params.actorUserId,
      })
      .returning({ id: platformOperatingMonthOverrides.id });
    if (!row) throw new Error("failed to insert operating-month override");
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.operating_month_override.granted",
      targetType: "operating_month_override",
      targetId: row.id,
      targetWorkspaceId: params.workspaceId,
      afterJson: { type: params.type, expiresAt: params.expiresAt ?? null },
    });
    return { id: row.id };
  });
}

/** Revoke an override (never hard-deleted). Returns null if not found. */
export async function revokeMonthOverride(params: { overrideId: string; actorUserId: string }): Promise<{ id: string; workspaceId: string } | null> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(platformOperatingMonthOverrides)
      .set({ revokedAt: new Date(), revokedByUserId: params.actorUserId })
      .where(and(eq(platformOperatingMonthOverrides.id, params.overrideId), isNull(platformOperatingMonthOverrides.revokedAt)))
      .returning({ id: platformOperatingMonthOverrides.id, workspaceId: platformOperatingMonthOverrides.workspaceId });
    if (!row) return null;
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.operating_month_override.revoked",
      targetType: "operating_month_override",
      targetId: row.id,
      targetWorkspaceId: row.workspaceId,
      afterJson: { revoked: true },
    });
    return row;
  });
}

/** Active override state for one workspace — used by Customer 360's platform read. */
export async function getActiveMonthOverrideStatePlatform(workspaceId: string): Promise<{ prepBlocked: boolean; earlyPrepAllowed: boolean }> {
  const rows = await getPlatformAdminDb()
    .select({ type: platformOperatingMonthOverrides.type })
    .from(platformOperatingMonthOverrides)
    .where(
      and(
        eq(platformOperatingMonthOverrides.workspaceId, workspaceId),
        isNull(platformOperatingMonthOverrides.revokedAt),
        or(isNull(platformOperatingMonthOverrides.expiresAt), sql`${platformOperatingMonthOverrides.expiresAt} > now()`),
      ),
    );
  return {
    prepBlocked: rows.some((r) => r.type === "PREP_BLOCKED"),
    earlyPrepAllowed: rows.some((r) => r.type === "EARLY_PREP_ALLOWED"),
  };
}
