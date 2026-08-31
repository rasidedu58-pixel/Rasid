/**
 * Identity repository — Phase 1.
 *
 * Typed query helpers for the users/workspaces/memberships tables. Contains
 * no HTTP/framework concerns; callers (apps/api) inject a database handle.
 *
 * Concurrency note (idempotent provisioning):
 * `createUserWorkspaceMembership` uses `INSERT ... ON CONFLICT (id) DO
 * NOTHING` on the `users` primary key inside a single transaction. When two
 * requests for the same Supabase auth user id race, PostgreSQL serializes
 * them at the row level: the second transaction's INSERT blocks on the
 * first transaction's not-yet-committed primary key lock, and once the
 * first commits, the second's ON CONFLICT clause resolves to "no rows
 * inserted". The (losing) caller then reads back the row(s) the winning
 * transaction already committed (user + workspace + membership), so both
 * callers observe exactly one workspace/membership for that user — no
 * second workspace is ever created for the same auth user id.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { withRuntimeContext } from "../connection";
import { users } from "../schema/identity";
import { memberships } from "../schema/permissions";
import { workspaces } from "../schema/workspaces";
import type * as schema from "../schema/index";
import { provisionSubscriptionForNewWorkspaceTransaction } from "./subscriptions.repository";

export type Db = PostgresJsDatabase<typeof schema>;

export type UserRow = typeof users.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type MembershipRow = typeof memberships.$inferSelect;

export interface ProvisionedIdentity {
  user: UserRow;
  workspace: WorkspaceRow;
  membership: MembershipRow;
}

export interface ProvisionInput {
  /** Verified Supabase Auth user id — becomes users.id directly. */
  authUserId: string;
  /** Display-only mirror of the verified identity's email. */
  email: string | null;
  /** Best-effort initial display name; onboarding may update it later. */
  fullName: string;
}

const DEFAULT_WORKSPACE_LOCALE = "ar-EG";
const DEFAULT_WORKSPACE_TIMEZONE = "Africa/Cairo";
const DEFAULT_WORKSPACE_TYPE = "TEACHER";
const DEFAULT_DUE_DATE_POLICY = "PER_GROUP";
const OWNER_ROLE_LABEL = "OWNER";
const ACTIVE_MEMBERSHIP_STATUS = "ACTIVE";
const ACTIVE_WORKSPACE_STATUS = "ACTIVE";
const ACTIVE_USER_STATUS = "ACTIVE";

export function findUserByAuthId(db: Db, authUserId: string): Promise<UserRow | undefined> {
  return db
    .select()
    .from(users)
    .where(eq(users.id, authUserId))
    .limit(1)
    .then((rows) => rows[0]);
}

/**
 * Loads the (user, owner workspace, owner membership) triple for an
 * already-provisioned auth user id. Returns undefined only if provisioning
 * has genuinely never completed for this id.
 *
 * Exported since Phase 15: the API's provision adapter uses this as a
 * cheap read-only fast path (steady state — every request after the very
 * first) before falling back to the full write transaction below.
 */
export async function loadProvisionedIdentity(
  db: Db,
  authUserId: string,
): Promise<ProvisionedIdentity | undefined> {
  const rows = await db
    .select({ user: users, workspace: workspaces, membership: memberships })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(users.id, authUserId))
    .limit(1);

  return rows[0];
}

/**
 * Idempotently ensures a User + owner Workspace + owner Membership exist
 * for the given verified Supabase auth user id. Safe under concurrent
 * duplicate calls — see module-level concurrency note above.
 *
 * `pregeneratedWorkspaceId`: since the 0005 tenant-isolation RLS policies
 * apply the same expression to `WITH CHECK` as `USING` (a policy declared
 * without an explicit `FOR` clause governs INSERT too), an INSERT whose
 * `workspace_id` doesn't match the already-`SET LOCAL`'d `app.workspace_id`
 * is rejected by RLS for the least-privilege runtime role. The caller (see
 * `DrizzleIdentityRepository.provision`) pre-generates this id and sets
 * `app.workspace_id` to it via `withRuntimeContext` BEFORE this function's
 * transaction runs, so the new workspace/membership rows' `workspace_id`
 * always matches what RLS expects — even though this id is only used when
 * a NEW workspace actually gets created below (the idempotent
 * already-provisioned branch reads back existing rows instead, relying on
 * the `*_self_read` RLS policies keyed on `app.user_id`, not this id).
 */
export async function createUserWorkspaceMembership(
  db: Db,
  input: ProvisionInput,
  pregeneratedWorkspaceId: string,
): Promise<ProvisionedIdentity> {
  return db.transaction(async (tx) => {
    const insertedUsers = await tx
      .insert(users)
      .values({
        id: input.authUserId,
        fullName: input.fullName,
        emailDisplay: input.email,
        status: ACTIVE_USER_STATUS,
      })
      .onConflictDoNothing({ target: users.id })
      .returning();

    const newUser = insertedUsers[0];

    if (!newUser) {
      // Another (concurrent or earlier) call already provisioned this
      // identity. Read back its committed state rather than creating a
      // second workspace/membership.
      const existing = await loadProvisionedIdentity(tx as unknown as Db, input.authUserId);
      if (!existing) {
        throw new Error(
          `Inconsistent state: users row exists for ${input.authUserId} but no owner workspace/membership was found.`,
        );
      }
      return existing;
    }

    const [newWorkspace] = await tx
      .insert(workspaces)
      .values({
        id: pregeneratedWorkspaceId,
        ownerUserId: newUser.id,
        name: input.fullName,
        workspaceType: DEFAULT_WORKSPACE_TYPE,
        locale: DEFAULT_WORKSPACE_LOCALE,
        timezone: DEFAULT_WORKSPACE_TIMEZONE,
        dueDatePolicy: DEFAULT_DUE_DATE_POLICY,
        status: ACTIVE_WORKSPACE_STATUS,
      })
      .returning();

    if (!newWorkspace) {
      throw new Error(`Failed to create owner workspace for user ${newUser.id}.`);
    }

    const [newMembership] = await tx
      .insert(memberships)
      .values({
        workspaceId: newWorkspace.id,
        userId: newUser.id,
        roleLabel: OWNER_ROLE_LABEL,
        status: ACTIVE_MEMBERSHIP_STATUS,
        joinedAt: new Date(),
      })
      .returning();

    if (!newMembership) {
      throw new Error(`Failed to create owner membership for user ${newUser.id}.`);
    }

    // Phase 8 — same transaction as the new owner workspace itself: either
    // the 14-day ordinary trial (first time this verified identity has
    // ever owned a workspace) or an immediately-EXPIRED subscription
    // (repeat identity — see subscriptions.repository.ts's own doc
    // comment on why EXPIRED, not a skipped/missing row).
    await provisionSubscriptionForNewWorkspaceTransaction(tx as unknown as Db, {
      workspaceId: newWorkspace.id,
      ownerUserId: newUser.id,
      email: input.email,
    });

    return { user: newUser, workspace: newWorkspace, membership: newMembership };
  });
}

export interface MembershipWithWorkspace {
  membership: MembershipRow;
  workspace: WorkspaceRow;
}

/** All memberships (any status) for a user, joined to their workspace. */
export function listMembershipsForUser(db: Db, userId: string): Promise<MembershipWithWorkspace[]> {
  return db
    .select({ membership: memberships, workspace: workspaces })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId));
}

export interface UserWithMemberships {
  user: UserRow;
  memberships: MembershipWithWorkspace[];
}

/**
 * Phase 15C — the user row PLUS all their memberships/workspaces in ONE
 * query (one RLS transaction), for `GET /me`'s steady-state fast path.
 * Replaces the previous two transactions (`loadProvisionedIdentity` LIMIT-1
 * read + `listMembershipsForUser`) that read the same identity graph twice.
 * Returns `undefined` when the identity has never been provisioned (no
 * rows) — the caller then falls back to the provisioning path, so a
 * brand-new user is still created exactly as before. Runs under the same
 * `app.user_id` self-read RLS policies as the queries it replaces.
 */
export async function loadUserWithMemberships(db: Db, userId: string): Promise<UserWithMemberships | undefined> {
  const rows = await db
    .select({ user: users, membership: memberships, workspace: workspaces })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(users.id, userId));
  if (rows.length === 0) return undefined;
  return {
    user: rows[0]!.user,
    memberships: rows.map((r) => ({ membership: r.membership, workspace: r.workspace })),
  };
}

/** A user's membership in one specific workspace, if any (any status). */
export async function findMembership(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<MembershipWithWorkspace | undefined> {
  const rows = await db
    .select({ membership: memberships, workspace: workspaces })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
    .limit(1);

  return rows[0];
}

export interface OnboardingCompleteInput {
  workspaceId: string;
  displayName: string;
  dueDatePolicy: "UNIFIED" | "PER_GROUP";
  unifiedDueDay: number | null;
}

/**
 * Persists onboarding output onto the workspace row. `displayName` maps to
 * `workspaces.name` (no separate "display name" column exists in the
 * approved schema §4.2).
 */
export async function completeOnboarding(
  db: Db,
  input: OnboardingCompleteInput,
): Promise<WorkspaceRow> {
  const [updated] = await db
    .update(workspaces)
    .set({
      name: input.displayName,
      dueDatePolicy: input.dueDatePolicy,
      unifiedDueDay: input.unifiedDueDay,
      updatedAt: new Date(),
    })
    .where(eq(workspaces.id, input.workspaceId))
    .returning();

  if (!updated) {
    throw new Error(`Workspace ${input.workspaceId} not found while completing onboarding.`);
  }
  return updated;
}

/**
 * The workspace's operational status only (ACTIVE / SUSPENDED / ARCHIVED).
 * Read on the per-request hot path by `PermissionGuard` to block a SUSPENDED
 * customer from operating — kept as a single indexed PK lookup, no joins.
 * Returns `undefined` if the workspace doesn't exist / isn't visible under RLS.
 */
/**
 * Ensures ONLY the application `users` row exists for an already-authenticated
 * identity — with NO tenant provisioning (no workspace, no owner membership, no
 * trial/subscription). This is the minimal-footprint counterpart to
 * {@link createUserWorkspaceMembership} for identities that must exist as an
 * application user but are NOT tenants — specifically a person accepting a
 * Platform Staff invitation, who may not be a teacher and must never get a
 * teaching workspace or trial just by joining فريق راصد.
 *
 * Runs on the caller's OWN `app_runtime` context (the `users_self_insert` RLS
 * policy admits `id = app.user_id`), reusing the same idempotent
 * `ON CONFLICT (id) DO NOTHING` insert — so it is safe to call for a user who
 * already exists (e.g. an existing teacher joining staff). Identity fields come
 * from the verified JWT, never from client input.
 */
/**
 * Updates the caller's OWN profile fields (teacher onboarding Step-2 + settings
 * edit). Runs under the `users_self_update` RLS policy (migration 0061) — the
 * adapter wraps this in `withRuntimeContext({ userId })`, so RLS admits only the
 * caller's own row. Only the whitelisted profile columns are ever written here
 * (never id/status/email/created_at); values are already validated by the API
 * against the governorate/subject enums + normalized Egyptian phone. A `null`
 * for subjectOther explicitly clears it (when subject != OTHER). `undefined`
 * fields are left unchanged. Returns the updated row.
 */
export async function updateUserProfile(
  db: Db,
  userId: string,
  patch: { fullName?: string; phone?: string; governorate?: string; subject?: string; subjectOther?: string | null },
): Promise<UserRow | undefined> {
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.fullName !== undefined) set.fullName = patch.fullName;
  if (patch.phone !== undefined) set.phone = patch.phone;
  if (patch.governorate !== undefined) set.governorate = patch.governorate;
  if (patch.subject !== undefined) set.subject = patch.subject;
  if (patch.subjectOther !== undefined) set.subjectOther = patch.subjectOther;
  const [updated] = await db.update(users).set(set).where(eq(users.id, userId)).returning();
  return updated;
}

export async function ensureApplicationUser(input: { authUserId: string; email: string | null; fullName: string }): Promise<void> {
  await withRuntimeContext({ userId: input.authUserId }, (db) =>
    db
      .insert(users)
      .values({ id: input.authUserId, fullName: input.fullName, emailDisplay: input.email, status: ACTIVE_USER_STATUS })
      .onConflictDoNothing({ target: users.id }),
  );
}

export async function findWorkspaceStatus(db: Db, workspaceId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: workspaces.status })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row?.status;
}
