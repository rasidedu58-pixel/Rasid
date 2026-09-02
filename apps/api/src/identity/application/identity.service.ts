import { Inject, Injectable } from "@nestjs/common";
import {
  governorateSchema,
  isTeacherProfileComplete,
  normalizeEgyptianPhone,
  onboardingCompleteRequestSchema,
  subjectSchema,
  updateTeacherProfileRequestSchema,
  type MeResponse,
  type OnboardingCompleteResponse,
  type PlatformRole,
  type TeacherProfile,
  type WorkspaceContextResponse,
} from "@academic-precision/contracts";
import type { ZodError } from "zod";
import type { MembershipWithWorkspace, UserRow } from "@academic-precision/database";
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
  private async ensureProvisioned(authUser: VerifiedSupabaseToken) {
    const provisioned = await this.repository.provision({
      authUserId: authUser.id,
      email: authUser.email,
      // FIRST trusted name wins: the signup name (Supabase user_metadata,
      // surfaced on the verified token) is used so it is never lost. Only when
      // the token carries no name do we fall back to the email local-part, then
      // a neutral default. Provisioning is idempotent (ON CONFLICT DO NOTHING),
      // so this sets the name exactly once — later edits go through the profile.
      fullName: authUser.fullName || authUser.email?.split("@")[0]?.trim() || DEFAULT_FULL_NAME,
    });
    // Backfill the teacher profile from signup metadata for a BRAND-NEW account
    // (phone/governorate/subject are now required at signup). Only when the
    // profile is still empty — never overwrites a later edit — and only with
    // values that validate/normalize (untrusted metadata). Legacy/invite
    // accounts without metadata fall through to the onboarding step unchanged.
    if (!provisioned.user.phone && authUser.governorate && authUser.subject) {
      const phone = normalizeEgyptianPhone(authUser.phone ?? "");
      const gov = governorateSchema.safeParse(authUser.governorate);
      const subj = subjectSchema.safeParse(authUser.subject);
      if (phone && gov.success && subj.success) {
        const updated = await this.repository.updateProfile(provisioned.user.id, {
          phone,
          governorate: gov.data,
          subject: subj.data,
          subjectOther: subj.data === "OTHER" ? authUser.subjectOther ?? null : null,
        });
        if (updated) return { ...provisioned, user: updated };
      }
    }
    return provisioned;
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
      const role = await this.repository.getPlatformRole(loaded.user.id);
      return this.toMeResponse(loaded.user, loaded.memberships, role);
    }

    const provisioned = await this.ensureProvisioned(authUser);
    const memberships = await this.repository.listMemberships(provisioned.user.id);
    const role = await this.repository.getPlatformRole(provisioned.user.id);
    return this.toMeResponse(provisioned.user, memberships, role);
  }

  private toProfile(user: UserRow): TeacherProfile {
    return {
      phone: user.phone ?? null,
      governorate: user.governorate ?? null,
      subject: user.subject ?? null,
      subjectOther: user.subjectOther ?? null,
      profileCompleted: isTeacherProfileComplete(user),
    };
  }

  private toMeResponse(
    user: UserRow,
    memberships: MembershipWithWorkspace[],
    platformRole: PlatformRole | null,
  ): MeResponse {
    return {
      user: { id: user.id, fullName: user.fullName },
      workspaces: memberships.map(({ membership, workspace }) => ({
        id: workspace.id,
        name: workspace.name,
        roleLabel: membership.roleLabel,
        status: membership.status as "INVITED" | "ACTIVE" | "DISABLED",
      })),
      platform: { isStaff: platformRole !== null, role: platformRole },
      profile: this.toProfile(user),
    };
  }

  /**
   * Teacher profile update — backs Step-2 onboarding AND settings edit. The
   * caller can only edit their OWN row (repository runs under the
   * `users_self_update` RLS policy). Phone is normalized to E.164 (+20…) before
   * storage; setting a non-OTHER subject clears any stale `subject_other`.
   * "Onboarded" is derived deterministically from the resulting fields.
   */
  async updateProfile(authUser: VerifiedSupabaseToken, body: unknown): Promise<TeacherProfile> {
    // Ensure the user row exists (a brand-new owner may edit before any other
    // read provisioned them). Idempotent.
    await this.ensureProvisioned(authUser);

    const parsed = updateTeacherProfileRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationApiException(this.toFieldErrors(parsed.error));
    }
    const d = parsed.data;

    const patch: { fullName?: string; phone?: string; governorate?: string; subject?: string; subjectOther?: string | null } = {};
    if (d.fullName !== undefined) patch.fullName = d.fullName;
    if (d.phone !== undefined) patch.phone = normalizeEgyptianPhone(d.phone) ?? d.phone; // schema already validated normalizability
    if (d.governorate !== undefined) patch.governorate = d.governorate;
    if (d.subject !== undefined) {
      patch.subject = d.subject;
      // A concrete subject clears any prior "other" text; OTHER keeps the given text.
      patch.subjectOther = d.subject === "OTHER" ? (d.subjectOther ?? null) : null;
    } else if (d.subjectOther !== undefined) {
      patch.subjectOther = d.subjectOther;
    }

    const updated = await this.repository.updateProfile(authUser.id, patch);
    if (!updated) throw new ResourceNotFoundException();
    return this.toProfile(updated);
  }

  async getWorkspaceContext(
    authUser: VerifiedSupabaseToken,
    workspaceId: string,
  ): Promise<WorkspaceContextResponse> {
    // Phase 15C — membership FIRST. A caller who is a member of this
    // workspace is necessarily provisioned, so the provision fast-path read
    // is pure overhead on the hot path. We only run `ensureProvisioned` on
    // a miss, preserving the "first authenticated request provisions a
    // brand-new identity" behaviour before returning the same safe 404.
    let found = await this.repository.findMembership(workspaceId, authUser.id);
    if (!found) {
      await this.ensureProvisioned(authUser);
      found = await this.repository.findMembership(workspaceId, authUser.id);
    }

    if (!found || found.membership.status !== ACTIVE_STATUS) {
      // Safe no-leak (API Contract §5.2/§12): identical response whether
      // the workspace does not exist or the caller has no active
      // membership in it — existence of the resource is never confirmed.
      throw new ResourceNotFoundException();
    }

    const [commercial, effectiveGrants] = await Promise.all([
      // Phase 15C — subscription + entitlements in ONE transaction.
      this.repository.loadWorkspaceCommercialState(workspaceId),
      // NOTE: deliberately NOT passing `found.membership` as a resolver
      // hint here. `found` comes from the IDENTITY repository, which is a
      // separate membership source from the resolver's TEAM repository
      // (defense-in-depth: the permission set must never be fabricated from
      // the identity-side membership alone — see this method's own test).
      // The resolver does its own independent membership lookup. This is
      // the one place the /students /groups guard-hint reuse does NOT apply.
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
      entitlements: commercial.allowedEntitlements.map((e) => e.capability),
      subscriptionState: commercial.subscription?.state ?? null,
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
