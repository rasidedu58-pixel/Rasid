/**
 * Platform Staff Management repository ("فريق راصد") — migration 0060.
 *
 * A platform staff member is a `platform_admins` row (company-level, NOT a
 * tenant membership). New staff join ONLY by accepting a secure, single-use,
 * expiring invite — no admin ever sets a password. Every mutation appends a
 * `platform_audit_events` row inside the same transaction.
 *
 * Connections: management/accept run on `getPlatformAdminDb()`
 * (`app_platform_admin`), the only role granted write on `platform_admins`
 * (0060). Authorization (OWNER-only `platform.staff.manage`) is enforced by the
 * controller guards before any of these run; the last-PLATFORM_OWNER protection
 * here is a data-integrity backstop that holds even if a guard were bypassed.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getPlatformAdminDb } from "../connection";
import { users } from "../schema/identity";
import { platformAdmins, platformStaffInvitations, platformAuditEvents } from "../schema/platform-admin";

export type PlatformStaffRole = "PLATFORM_OWNER" | "OPERATIONS_ADMIN" | "SUPPORT_AGENT";
const PLATFORM_ROLES = ["PLATFORM_OWNER", "OPERATIONS_ADMIN", "SUPPORT_AGENT"] as const;
function isPlatformRole(value: string): value is PlatformStaffRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}
function coerceRole(value: string): PlatformStaffRole {
  return isPlatformRole(value) ? value : "SUPPORT_AGENT";
}

type Tx = Parameters<Parameters<ReturnType<typeof getPlatformAdminDb>["transaction"]>[0]>[0];
async function writeAudit(
  tx: Tx,
  params: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    targetWorkspaceId?: string | null;
    beforeJson?: unknown;
    afterJson?: unknown;
    reason?: string | null;
  },
): Promise<void> {
  await tx.insert(platformAuditEvents).values({
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId ?? null,
    targetWorkspaceId: params.targetWorkspaceId ?? null,
    beforeJson: (params.beforeJson ?? null) as never,
    afterJson: (params.afterJson ?? null) as never,
    reason: params.reason ?? null,
  });
}

// --- Staff listing ----------------------------------------------------------
export interface PlatformStaffMemberRow {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: PlatformStaffRole;
  status: "ACTIVE" | "DISABLED";
  invitedByName: string | null;
  grantedAt: Date;
}

export async function listPlatformStaffMembers(): Promise<PlatformStaffMemberRow[]> {
  const inviter = alias(users, "inviter");
  const rows = await getPlatformAdminDb()
    .select({
      userId: platformAdmins.userId,
      fullName: users.fullName,
      email: users.emailDisplay,
      role: platformAdmins.role,
      status: platformAdmins.status,
      invitedByName: inviter.fullName,
      grantedAt: platformAdmins.grantedAt,
    })
    .from(platformAdmins)
    .innerJoin(users, eq(users.id, platformAdmins.userId))
    .leftJoin(inviter, eq(inviter.id, platformAdmins.invitedByUserId))
    .orderBy(users.fullName);
  return rows.map((r) => ({
    userId: r.userId,
    fullName: r.fullName,
    email: r.email,
    role: coerceRole(r.role),
    status: r.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    invitedByName: r.invitedByName,
    grantedAt: r.grantedAt,
  }));
}

/** Count of staff who are ACTIVE PLATFORM_OWNERs — the last-owner backstop. */
async function countActiveOwners(tx: Tx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.role, "PLATFORM_OWNER"), eq(platformAdmins.status, "ACTIVE")));
  return row?.n ?? 0;
}

// --- Staff invitations ------------------------------------------------------
export type PlatformStaffInvitationRow = typeof platformStaffInvitations.$inferSelect;

export async function createStaffInvitation(input: {
  email: string;
  role: PlatformStaffRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
}): Promise<{ id: string }> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(platformStaffInvitations)
      .values({
        email: input.email,
        role: input.role,
        tokenHash: input.tokenHash,
        status: "PENDING",
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
      })
      .returning({ id: platformStaffInvitations.id });
    if (!inserted) throw new Error("Failed to insert platform_staff_invitations row.");
    await writeAudit(tx, {
      actorUserId: input.invitedByUserId,
      action: "platform.staff.invited",
      targetType: "platform_staff_invitation",
      targetId: inserted.id,
      // Never log the raw token or hash — only non-secret metadata.
      afterJson: { email: input.email, role: input.role, expiresAt: input.expiresAt.toISOString() },
    });
    return inserted;
  });
}

export async function listStaffInvitations(): Promise<PlatformStaffInvitationRow[]> {
  return getPlatformAdminDb()
    .select()
    .from(platformStaffInvitations)
    .orderBy(desc(platformStaffInvitations.createdAt))
    .limit(100);
}

export async function findStaffInvitationById(id: string): Promise<PlatformStaffInvitationRow | undefined> {
  const [row] = await getPlatformAdminDb().select().from(platformStaffInvitations).where(eq(platformStaffInvitations.id, id)).limit(1);
  return row;
}

export async function revokeStaffInvitation(id: string, actorUserId: string): Promise<boolean> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(platformStaffInvitations)
      .set({ status: "REVOKED", revokedAt: new Date() })
      .where(and(eq(platformStaffInvitations.id, id), eq(platformStaffInvitations.status, "PENDING")))
      .returning({ id: platformStaffInvitations.id });
    if (!updated) return false;
    await writeAudit(tx, { actorUserId, action: "platform.staff.invite_revoked", targetType: "platform_staff_invitation", targetId: id });
    return true;
  });
}

export interface StaffInvitationPreview {
  valid: boolean;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  email: string;
  role: PlatformStaffRole;
  invitedByName: string | null;
  expiresAt: string;
}

export async function previewStaffInvitation(tokenHash: string): Promise<StaffInvitationPreview | null> {
  const inviter = alias(users, "inviter");
  const [row] = await getPlatformAdminDb()
    .select({
      email: platformStaffInvitations.email,
      role: platformStaffInvitations.role,
      status: platformStaffInvitations.status,
      expiresAt: platformStaffInvitations.expiresAt,
      invitedByName: inviter.fullName,
    })
    .from(platformStaffInvitations)
    .leftJoin(inviter, eq(inviter.id, platformStaffInvitations.invitedByUserId))
    .where(eq(platformStaffInvitations.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  return {
    valid: row.status === "PENDING" && row.expiresAt.getTime() > Date.now(),
    status: row.status as StaffInvitationPreview["status"],
    email: row.email,
    role: coerceRole(row.role),
    invitedByName: row.invitedByName,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export type AcceptStaffInvitationResult =
  | { ok: true; role: PlatformStaffRole }
  | { ok: false; reason: "INVALID" | "EMAIL_MISMATCH" | "ALREADY_ADMIN" };

/**
 * Accepts a staff invite ATOMICALLY: validate PENDING + unexpired + email match,
 * flip PENDING→ACCEPTED with a row-lock race guard, then INSERT the
 * `platform_admins` row (no privilege existed before this commit). Already being
 * a platform admin returns ALREADY_ADMIN and leaves the invite untouched.
 */
export async function acceptStaffInvitationTx(params: {
  tokenHash: string;
  accepterUserId: string;
  accepterEmail: string | null;
}): Promise<AcceptStaffInvitationResult> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(platformStaffInvitations).where(eq(platformStaffInvitations.tokenHash, params.tokenHash)).limit(1);
    if (!invite || invite.status !== "PENDING" || invite.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "INVALID" } as const;
    }
    // Bind the invite to its intended recipient — the token alone must not let a
    // different signed-in account claim platform privilege.
    if (!params.accepterEmail || params.accepterEmail.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
      return { ok: false, reason: "EMAIL_MISMATCH" } as const;
    }
    const [existing] = await tx.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.userId, params.accepterUserId)).limit(1);
    if (existing) return { ok: false, reason: "ALREADY_ADMIN" } as const;

    const [claimed] = await tx
      .update(platformStaffInvitations)
      .set({ status: "ACCEPTED", acceptedByUserId: params.accepterUserId, acceptedAt: new Date() })
      .where(
        and(
          eq(platformStaffInvitations.id, invite.id),
          eq(platformStaffInvitations.status, "PENDING"),
          gt(platformStaffInvitations.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: platformStaffInvitations.id });
    if (!claimed) return { ok: false, reason: "INVALID" } as const;

    const role = coerceRole(invite.role);
    await tx.insert(platformAdmins).values({
      userId: params.accepterUserId,
      role,
      status: "ACTIVE",
      invitedByUserId: invite.invitedByUserId,
      note: "Joined via staff invitation.",
    });

    await writeAudit(tx, {
      actorUserId: params.accepterUserId,
      action: "platform.staff.invite_accepted",
      targetType: "platform_admin",
      targetId: params.accepterUserId,
      afterJson: { role, invitationId: invite.id },
    });
    return { ok: true, role } as const;
  });
}

// --- Role change / disable / reactivate -------------------------------------
export type StaffMutationResult =
  | { ok: true; role: PlatformStaffRole; status: "ACTIVE" | "DISABLED" }
  | { ok: false; reason: "NOT_FOUND" | "LAST_OWNER" };

export async function changePlatformStaffRole(params: {
  targetUserId: string;
  newRole: PlatformStaffRole;
  actorUserId: string;
  reason: string;
}): Promise<StaffMutationResult> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(platformAdmins).where(eq(platformAdmins.userId, params.targetUserId)).limit(1);
    if (!target) return { ok: false, reason: "NOT_FOUND" } as const;
    const before = coerceRole(target.role);
    // Never leave the platform without an ACTIVE owner: demoting the last one is
    // blocked (an already-DISABLED owner does not count toward the safety floor).
    if (before === "PLATFORM_OWNER" && params.newRole !== "PLATFORM_OWNER" && target.status === "ACTIVE") {
      if ((await countActiveOwners(tx)) <= 1) return { ok: false, reason: "LAST_OWNER" } as const;
    }
    await tx.update(platformAdmins).set({ role: params.newRole }).where(eq(platformAdmins.userId, params.targetUserId));
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.staff.role_changed",
      targetType: "platform_admin",
      targetId: params.targetUserId,
      beforeJson: { role: before },
      afterJson: { role: params.newRole },
      reason: params.reason,
    });
    return { ok: true, role: params.newRole, status: target.status === "DISABLED" ? "DISABLED" : "ACTIVE" } as const;
  });
}

export async function setPlatformStaffStatus(params: {
  targetUserId: string;
  action: "DISABLE" | "REACTIVATE";
  actorUserId: string;
  reason: string;
}): Promise<StaffMutationResult> {
  const db = getPlatformAdminDb();
  const nextStatus = params.action === "DISABLE" ? "DISABLED" : "ACTIVE";
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(platformAdmins).where(eq(platformAdmins.userId, params.targetUserId)).limit(1);
    if (!target) return { ok: false, reason: "NOT_FOUND" } as const;
    const role = coerceRole(target.role);
    // Disabling the last ACTIVE owner would leave the platform ownerless — block.
    if (params.action === "DISABLE" && role === "PLATFORM_OWNER" && target.status === "ACTIVE") {
      if ((await countActiveOwners(tx)) <= 1) return { ok: false, reason: "LAST_OWNER" } as const;
    }
    await tx
      .update(platformAdmins)
      .set({ status: nextStatus, disabledAt: params.action === "DISABLE" ? new Date() : null })
      .where(eq(platformAdmins.userId, params.targetUserId));
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: params.action === "DISABLE" ? "platform.staff.disabled" : "platform.staff.reactivated",
      targetType: "platform_admin",
      targetId: params.targetUserId,
      beforeJson: { status: target.status },
      afterJson: { status: nextStatus },
      reason: params.reason,
    });
    return { ok: true, role, status: nextStatus } as const;
  });
}
