/**
 * Customer onboarding invitations repository — migration 0060.
 *
 * The platform records a customer's identity and mints a secure, expiring,
 * single-use onboarding link (SHA-256 token hash stored only). The customer
 * opens it and authenticates through the normal Supabase Auth flow; the
 * existing lazy provisioning creates their OWN workspace + trial per current
 * Product Rules. This invite provisions NOTHING itself — it is a tracked,
 * auditable record claimed atomically on first authenticated arrival. Platform
 * table; all reads/writes run on `getPlatformAdminDb()` (`app_platform_admin`),
 * except the claim which is initiated by the freshly-onboarded customer.
 */
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getPlatformAdminDb } from "../connection";
import { users } from "../schema/identity";
import { workspaces } from "../schema/workspaces";
import { platformCustomerInvitations, platformAuditEvents } from "../schema/platform-admin";

type Tx = Parameters<Parameters<ReturnType<typeof getPlatformAdminDb>["transaction"]>[0]>[0];
async function writeAudit(
  tx: Tx,
  params: { actorUserId: string; action: string; targetId?: string | null; targetWorkspaceId?: string | null; afterJson?: unknown; reason?: string | null },
): Promise<void> {
  await tx.insert(platformAuditEvents).values({
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: "platform_customer_invitation",
    targetId: params.targetId ?? null,
    targetWorkspaceId: params.targetWorkspaceId ?? null,
    afterJson: (params.afterJson ?? null) as never,
    reason: params.reason ?? null,
  });
}

export type CustomerInvitationRow = typeof platformCustomerInvitations.$inferSelect;

export async function createCustomerInvitation(input: {
  fullName: string;
  email: string;
  phone: string | null;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
}): Promise<{ id: string }> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(platformCustomerInvitations)
      .values({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        tokenHash: input.tokenHash,
        status: "PENDING",
        invitedByUserId: input.invitedByUserId,
        expiresAt: input.expiresAt,
      })
      .returning({ id: platformCustomerInvitations.id });
    if (!inserted) throw new Error("Failed to insert platform_customer_invitations row.");
    await writeAudit(tx, {
      actorUserId: input.invitedByUserId,
      action: "platform.customer.invited",
      targetId: inserted.id,
      afterJson: { fullName: input.fullName, email: input.email, expiresAt: input.expiresAt.toISOString() },
    });
    return inserted;
  });
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

export interface CustomerInvitationListItem extends CustomerInvitationRow {
  invitedByName: string | null;
}

export async function listCustomerInvitations(params: { cursor?: string; limit?: number }): Promise<{
  items: CustomerInvitationListItem[];
  nextCursor: string | null;
  hasNext: boolean;
}> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, 100);
  const cur = decodeCursor(params.cursor);
  const inviter = alias(users, "inviter");
  const rows = await getPlatformAdminDb()
    .select({
      inv: platformCustomerInvitations,
      invitedByName: inviter.fullName,
    })
    .from(platformCustomerInvitations)
    .leftJoin(inviter, eq(inviter.id, platformCustomerInvitations.invitedByUserId))
    .where(
      cur
        ? or(
            lt(platformCustomerInvitations.createdAt, cur.ts),
            and(eq(platformCustomerInvitations.createdAt, cur.ts), lt(platformCustomerInvitations.id, cur.id)),
          )
        : undefined,
    )
    .orderBy(desc(platformCustomerInvitations.createdAt), desc(platformCustomerInvitations.id))
    .limit(limit + 1);
  const hasNext = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ ...r.inv, invitedByName: r.invitedByName })),
    nextCursor: hasNext && last ? encodeCursor(last.inv.createdAt, last.inv.id) : null,
    hasNext,
  };
}

export async function findCustomerInvitationById(id: string): Promise<CustomerInvitationRow | undefined> {
  const [row] = await getPlatformAdminDb().select().from(platformCustomerInvitations).where(eq(platformCustomerInvitations.id, id)).limit(1);
  return row;
}

export async function revokeCustomerInvitation(id: string, actorUserId: string): Promise<boolean> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(platformCustomerInvitations)
      .set({ status: "REVOKED", revokedAt: new Date() })
      .where(and(eq(platformCustomerInvitations.id, id), eq(platformCustomerInvitations.status, "PENDING")))
      .returning({ id: platformCustomerInvitations.id });
    if (!updated) return false;
    await writeAudit(tx, { actorUserId, action: "platform.customer.invite_revoked", targetId: id });
    return true;
  });
}

export interface CustomerInvitationPreview {
  valid: boolean;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  fullName: string;
  email: string;
  expiresAt: string;
}

export async function previewCustomerInvitation(tokenHash: string): Promise<CustomerInvitationPreview | null> {
  const [row] = await getPlatformAdminDb()
    .select({
      fullName: platformCustomerInvitations.fullName,
      email: platformCustomerInvitations.email,
      status: platformCustomerInvitations.status,
      expiresAt: platformCustomerInvitations.expiresAt,
    })
    .from(platformCustomerInvitations)
    .where(eq(platformCustomerInvitations.tokenHash, tokenHash))
    .limit(1);
  if (!row) return null;
  return {
    valid: row.status === "PENDING" && row.expiresAt.getTime() > Date.now(),
    status: row.status as CustomerInvitationPreview["status"],
    fullName: row.fullName,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * The workspace the newly-onboarded customer OWNS (lazy provisioning creates
 * exactly one on first login). Read cross-tenant on `app_platform_admin` so the
 * claim can link the invite to it without trusting a client-supplied id.
 * Returns null if provisioning has not completed yet.
 */
export async function findPrimaryOwnedWorkspaceId(userId: string): Promise<string | null> {
  const [row] = await getPlatformAdminDb()
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, userId))
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export type ClaimCustomerInvitationResult =
  | { ok: true; workspaceId: string | null }
  | { ok: false; reason: "INVALID" | "EMAIL_MISMATCH" };

/**
 * Claims a customer invite ATOMICALLY once the customer has authenticated and
 * been provisioned (so `workspaceId` is their own new workspace). Single-use:
 * only the transaction that flips PENDING→ACCEPTED APPLIES the invited details.
 * The invite never created the workspace — lazy provisioning already did, on
 * first login — so this claim never creates a second workspace or trial.
 *
 * On the first (and only) successful claim it APPLIES the platform-recorded
 * identity to the customer's just-provisioned account, since provisioning seeds
 * only a JWT-derived placeholder name and no phone:
 *   - users.full_name  := invited fullName (authoritative for a platform-created
 *     customer; the claim runs before the customer does onboarding).
 *   - users.phone      := invited phone (only when provided — never nulls an
 *     existing value).
 *   - workspaces.name  := invited fullName (the workspace still holds the
 *     provisioning placeholder at claim time; onboarding may rename later).
 * These UPDATEs use the app_platform_admin write policies/grants added in 0059
 * (users full_name/phone, workspaces name) — NO new grant is required. A
 * re-claim finds status != PENDING and is a no-op, so nothing is re-applied.
 */
export async function claimCustomerInvitationTx(params: {
  tokenHash: string;
  accepterUserId: string;
  accepterEmail: string | null;
  workspaceId: string | null;
}): Promise<ClaimCustomerInvitationResult> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [invite] = await tx.select().from(platformCustomerInvitations).where(eq(platformCustomerInvitations.tokenHash, params.tokenHash)).limit(1);
    if (!invite || invite.status !== "PENDING" || invite.expiresAt.getTime() <= Date.now()) {
      return { ok: false, reason: "INVALID" } as const;
    }
    if (!params.accepterEmail || params.accepterEmail.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
      return { ok: false, reason: "EMAIL_MISMATCH" } as const;
    }
    const [claimed] = await tx
      .update(platformCustomerInvitations)
      .set({
        status: "ACCEPTED",
        acceptedByUserId: params.accepterUserId,
        acceptedWorkspaceId: params.workspaceId,
        acceptedAt: new Date(),
      })
      .where(
        and(
          eq(platformCustomerInvitations.id, invite.id),
          eq(platformCustomerInvitations.status, "PENDING"),
          gt(platformCustomerInvitations.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: platformCustomerInvitations.id });
    if (!claimed) return { ok: false, reason: "INVALID" } as const;

    // Apply the invited identity to the provisioned account (single-use path).
    const userPatch: { fullName: string; phone?: string } = { fullName: invite.fullName };
    if (invite.phone && invite.phone.trim().length > 0) userPatch.phone = invite.phone;
    await tx.update(users).set(userPatch).where(eq(users.id, params.accepterUserId));
    if (params.workspaceId) {
      await tx.update(workspaces).set({ name: invite.fullName }).where(eq(workspaces.id, params.workspaceId));
    }

    await writeAudit(tx, {
      actorUserId: params.accepterUserId,
      action: "platform.customer.invite_accepted",
      targetId: invite.id,
      targetWorkspaceId: params.workspaceId,
      afterJson: { workspaceId: params.workspaceId, appliedName: invite.fullName, appliedPhone: userPatch.phone ?? null },
    });
    return { ok: true, workspaceId: params.workspaceId } as const;
  });
}
