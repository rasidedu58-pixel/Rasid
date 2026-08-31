/**
 * Workspace feature overrides repository — migration 0060.
 *
 * A per-workspace ENABLE/DISABLE exception layered ON TOP of the GLOBAL
 * `feature_flags` availability. The catalog of override-able keys lives in code
 * (@academic-precision/contracts `PLATFORM_FEATURE_CATALOG`); the SERVICE
 * validates a requested key against it (an override can never switch on a
 * feature the code does not implement). This is NOT a billing entitlement and
 * NOT an RBAC bypass. Append-only: an override is revoked, never hard-deleted.
 *
 * "Active" override = revoked_at IS NULL AND (expires_at IS NULL OR expires_at
 * > now()). At most one active override per (workspace, feature) — enforced by
 * a partial unique index and by revoking the prior one in the same transaction.
 *
 * Connections: platform management runs on `getPlatformAdminDb()`. The runtime
 * feature gate ({@link resolveActiveFeatureOverride}) is called with the
 * caller's own `app_runtime` transaction (RLS admits only its own workspace).
 */
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getPlatformAdminDb } from "../connection";
import type { Db } from "./identity.repository";
import { users } from "../schema/identity";
import { featureFlags } from "../schema/feature-flags";
import { workspaceFeatureOverrides, platformAuditEvents } from "../schema/platform-admin";

export type FeatureOverrideState = "ENABLED" | "DISABLED";

type Tx = Parameters<Parameters<ReturnType<typeof getPlatformAdminDb>["transaction"]>[0]>[0];
async function writeAudit(
  tx: Tx,
  params: { actorUserId: string; action: string; targetWorkspaceId: string; beforeJson?: unknown; afterJson?: unknown; reason?: string | null },
): Promise<void> {
  await tx.insert(platformAuditEvents).values({
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: "workspace_feature_override",
    targetWorkspaceId: params.targetWorkspaceId,
    beforeJson: (params.beforeJson ?? null) as never,
    afterJson: (params.afterJson ?? null) as never,
    reason: params.reason ?? null,
  });
}

/** `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`. */
const activePredicate = () =>
  and(isNull(workspaceFeatureOverrides.revokedAt), or(isNull(workspaceFeatureOverrides.expiresAt), gt(workspaceFeatureOverrides.expiresAt, sql`now()`)));

// --- Global flag defaults (for Customer 360 display) ------------------------
export async function findGlobalFlagStates(keys: readonly string[]): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (keys.length === 0) return map;
  const rows = await getPlatformAdminDb().select({ key: featureFlags.key, enabled: featureFlags.enabled }).from(featureFlags);
  for (const r of rows) map.set(r.key, r.enabled);
  return map;
}

// --- Active overrides for a workspace (platform display) ---------------------
export interface ActiveFeatureOverrideRow {
  featureKey: string;
  state: FeatureOverrideState;
  reason: string;
  createdByName: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export async function listActiveFeatureOverrides(workspaceId: string): Promise<ActiveFeatureOverrideRow[]> {
  const creator = alias(users, "creator");
  const rows = await getPlatformAdminDb()
    .select({
      featureKey: workspaceFeatureOverrides.featureKey,
      state: workspaceFeatureOverrides.state,
      reason: workspaceFeatureOverrides.reason,
      createdByName: creator.fullName,
      createdAt: workspaceFeatureOverrides.createdAt,
      expiresAt: workspaceFeatureOverrides.expiresAt,
    })
    .from(workspaceFeatureOverrides)
    .leftJoin(creator, eq(creator.id, workspaceFeatureOverrides.createdByUserId))
    .where(and(eq(workspaceFeatureOverrides.workspaceId, workspaceId), activePredicate()))
    .orderBy(desc(workspaceFeatureOverrides.createdAt));
  return rows.map((r) => ({
    featureKey: r.featureKey,
    state: r.state === "DISABLED" ? "DISABLED" : "ENABLED",
    reason: r.reason,
    createdByName: r.createdByName,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  }));
}

/**
 * The runtime feature gate — call inside the caller's OWN `app_runtime`
 * transaction (RLS admits only its workspace). Returns the active override's
 * state for `featureKey`, or null when there is none (caller falls back to the
 * global flag). `now()` filtering happens in SQL so expiry is honored live.
 */
export async function resolveActiveFeatureOverride(db: Db, workspaceId: string, featureKey: string): Promise<FeatureOverrideState | null> {
  const [row] = await db
    .select({ state: workspaceFeatureOverrides.state })
    .from(workspaceFeatureOverrides)
    .where(and(eq(workspaceFeatureOverrides.workspaceId, workspaceId), eq(workspaceFeatureOverrides.featureKey, featureKey), activePredicate()))
    .limit(1);
  if (!row) return null;
  return row.state === "DISABLED" ? "DISABLED" : "ENABLED";
}

// --- Set / revoke (platform management) -------------------------------------
export async function setFeatureOverride(params: {
  workspaceId: string;
  featureKey: string;
  state: FeatureOverrideState;
  reason: string;
  actorUserId: string;
  expiresAt: Date | null;
}): Promise<{ id: string }> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    // Revoke any prior active override for this (workspace, feature) first, so
    // the partial unique index is satisfied and history is preserved.
    await tx
      .update(workspaceFeatureOverrides)
      .set({ revokedAt: new Date(), revokedByUserId: params.actorUserId })
      .where(and(eq(workspaceFeatureOverrides.workspaceId, params.workspaceId), eq(workspaceFeatureOverrides.featureKey, params.featureKey), isNull(workspaceFeatureOverrides.revokedAt)));

    const [inserted] = await tx
      .insert(workspaceFeatureOverrides)
      .values({
        workspaceId: params.workspaceId,
        featureKey: params.featureKey,
        state: params.state,
        reason: params.reason,
        createdByUserId: params.actorUserId,
        expiresAt: params.expiresAt,
      })
      .returning({ id: workspaceFeatureOverrides.id });
    if (!inserted) throw new Error("Failed to insert workspace_feature_overrides row.");

    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.feature.override_set",
      targetWorkspaceId: params.workspaceId,
      afterJson: { featureKey: params.featureKey, state: params.state, expiresAt: params.expiresAt ? params.expiresAt.toISOString() : null },
      reason: params.reason,
    });
    return inserted;
  });
}

export async function revokeFeatureOverride(params: {
  workspaceId: string;
  featureKey: string;
  actorUserId: string;
  reason: string;
}): Promise<boolean> {
  const db = getPlatformAdminDb();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(workspaceFeatureOverrides)
      .set({ revokedAt: new Date(), revokedByUserId: params.actorUserId })
      .where(and(eq(workspaceFeatureOverrides.workspaceId, params.workspaceId), eq(workspaceFeatureOverrides.featureKey, params.featureKey), isNull(workspaceFeatureOverrides.revokedAt)))
      .returning({ id: workspaceFeatureOverrides.id });
    if (!updated) return false;
    await writeAudit(tx, {
      actorUserId: params.actorUserId,
      action: "platform.feature.override_revoked",
      targetWorkspaceId: params.workspaceId,
      afterJson: { featureKey: params.featureKey },
      reason: params.reason,
    });
    return true;
  });
}
