import type { EntitlementState } from "@academic-precision/database";
import type { Capability } from "@academic-precision/database";

/**
 * Minimal port used ONLY by `EntitlementGuard` — deliberately narrower
 * than `BillingRepositoryPort` (which owns the full subscription/checkout/
 * webhook surface) so any module that just needs to GATE a route on an
 * Entitlement can import+re-provide this single-method port directly,
 * mirroring the established "re-provide guard dependencies per module,
 * avoid a module import cycle" convention (e.g. `TEAM_REPOSITORY` inside
 * every module that uses `PermissionGuard`).
 */
export interface EntitlementRepositoryPort {
  /** `undefined` = no entitlement row exists yet for this (workspace, capability) — treated as BLOCKED by the guard (fail-closed, never fail-open). */
  findCurrentEntitlementState(workspaceId: string, capability: Capability): Promise<EntitlementState | undefined>;
}

export const ENTITLEMENT_REPOSITORY = Symbol("ENTITLEMENT_REPOSITORY");
