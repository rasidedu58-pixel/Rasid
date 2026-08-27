import { Inject, Injectable } from "@nestjs/common";
import {
  onboardingCompleteRequestSchema,
  type MeResponse,
  type OnboardingCompleteResponse,
  type WorkspaceContextResponse,
} from "@academic-precision/contracts";
import type { ZodError } from "zod";
import type { MembershipWithWorkspace } from "@academic-precision/database";
import {
  ForbiddenApiException,
  ResourceNotFoundException,
  ValidationApiException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../infrastructure/jwt-token-verifier";
import { IDENTITY_REPOSITORY, type IdentityRepositoryPort } from "./ports/identity-repository.port";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";

const OWNER_ROLE_LABEL = "OWNER";
const ACTIVE_STATUS = "ACTIVE";
const DEFAULT_FULL_NAME = "مستخدم جديد";

/**
 * Application service — orchestrates identity/onboarding use cases.
 * Controllers stay thin; all authorization/business rules for this module
 * live here, not in the controller.
 */
@Injectable()
export class IdentityService {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  /**
   * Idempotently ensures a User + owner Workspace + owner Membership exist
   * for the verified caller. Triggered by the first authenticated request
   * from a verified identity; safe to call on every request afterward.
   */
  private ensureProvisioned(authUser: VerifiedSupabaseToken) {
    return this.repository.provision({
      authUserId: authUser.id,
      email: authUser.email,
      fullName: authUser.email?.split("@")[0]?.trim() || DEFAULT_FULL_NAME,
    });
  }

  async getMe(authUser: VerifiedSupabaseToken): Promise<MeResponse> {
    // Phase 15C — steady-state fast path: ONE transaction fetches the user
    // + all their memberships/workspaces. Previously this was two reads
    // (provision fast-path + listMemberships) of the same identity graph.
    // Only when the identity has never been provisioned (no rows) do we
    // fall back to the provisioning path — so a brand-new user is still
    // created exactly as before (no provisioning regression, no write on
    // the hot path). Supabase identity verification is unchanged (this runs
    // only after SupabaseAuthGuard has verified the token).
    const loaded = await this.repository.loadUserWithMemberships(authUser.id);
    if (loaded) {
      return this.toMeResponse(loaded.user.id, loaded.user.fullName, loaded.memberships);
    }

    const provisioned = await this.ensureProvisioned(authUser);
    const memberships = await this.repository.listMemberships(provisioned.user.id);
    return this.toMeResponse(provisioned.user.id, provisioned.user.fullName, memberships);
  }

  private toMeResponse(
    userId: string,
    fullName: string,
    memberships: MembershipWithWorkspace[],
  ): MeResponse {
    return {
      user: { id: userId, fullName },
      workspaces: memberships.map(({ membership, workspace }) => ({
        id: workspace.id,
        name: workspace.name,
        roleLabel: membership.roleLabel,
        status: membership.status as "INVITED" | "ACTIVE" | "DISABLED",
      })),
    };
  }

  async getWorkspaceContext(
    authUser: VerifiedSupabaseToken,
    workspaceId: string,
  ): Promise<WorkspaceContextResponse> {
    await this.ensureProvisioned(authUser);
    const found = await this.repository.findMembership(workspaceId, authUser.id);

    if (!found || found.membership.status !== ACTIVE_STATUS) {
      // Safe no-leak (API Contract §5.2/§12): identical response whether
      // the workspace does not exist or the caller has no active
      // membership in it — existence of the resource is never confirmed.
      throw new ResourceNotFoundException();
    }

    const [subscription, allowedEntitlements, effectiveGrants] = await Promise.all([
      this.repository.findSubscriptionByWorkspaceId(workspaceId),
      this.repository.listAllowedEntitlementsForWorkspace(workspaceId),
      this.permissionResolver.resolveEffectivePermissions(workspaceId, authUser.id),
    ]);

    return {
      workspace: {
        id: found.workspace.id,
        name: found.workspace.name,
        timezone: found.workspace.timezone,
      },
      membership: {
        id: found.membership.id,
        roleLabel: found.membership.roleLabel,
      },
      // Phase 11 fix: real effective permission keys (deduplicated — the
      // same key can appear via more than one grant/closure edge), backed
      // by the SAME `PermissionResolverService` every write endpoint's own
      // `PermissionGuard` already uses. This is UI-rendering guidance only
      // (show/hide nav and actions) — every mutation still re-checks
      // authorization server-side on its own, unconditionally.
      permissions: [...new Set(effectiveGrants.map((g) => g.permission))],
      entitlements: allowedEntitlements.map((e) => e.capability),
      subscriptionState: subscription?.state ?? null,
    };
  }

  async completeOnboarding(
    authUser: VerifiedSupabaseToken,
    body: unknown,
  ): Promise<OnboardingCompleteResponse> {
    const provisioned = await this.ensureProvisioned(authUser);
    const memberships = await this.repository.listMemberships(provisioned.user.id);
    const membership =
      memberships.find((m) => m.membership.status === ACTIVE_STATUS) ?? memberships[0];

    if (!membership || membership.membership.roleLabel !== OWNER_ROLE_LABEL) {
      throw new ForbiddenApiException();
    }

    const parsed = onboardingCompleteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationApiException(this.toFieldErrors(parsed.error));
    }

    const updated = await this.repository.completeOnboarding({
      workspaceId: membership.workspace.id,
      displayName: parsed.data.displayName,
      dueDatePolicy: parsed.data.dueDatePolicy,
      unifiedDueDay: parsed.data.unifiedDueDay ?? null,
    });

    return {
      workspace: {
        id: updated.id,
        name: updated.name,
        dueDatePolicy: updated.dueDatePolicy as "UNIFIED" | "PER_GROUP",
        unifiedDueDay: updated.unifiedDueDay,
      },
    };
  }

  private toFieldErrors(error: ZodError): Record<string, string[]> {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return fieldErrors;
  }
}
