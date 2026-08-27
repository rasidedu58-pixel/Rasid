import { Inject, Injectable } from "@nestjs/common";
import {
  PERMISSION_SCOPE_KIND,
  OWNER_ONLY_PERMISSION_KEYS,
  updateMembershipPermissionsRequestSchema,
  type DisableMembershipResponse,
  type ListTeamResponse,
  type PermissionKey,
  type UpdateMembershipPermissionsResponse,
} from "@academic-precision/contracts";
import type { DesiredGrantInput, GrantWithScopes } from "@academic-precision/database";
import type { ZodError } from "zod";
import {
  OwnerMembershipProtectedException,
  PermissionScopeInvalidException,
  ResourceNotFoundException,
  ValidationApiException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../api/guards/permission.guard";
import { GROUP_OWNERSHIP_PORT, type GroupOwnershipPort } from "./ports/group-ownership.port";
import { TEAM_REPOSITORY, type TeamRepositoryPort } from "./ports/team-repository.port";

const OWNER_ROLE_LABEL = "OWNER";
const DISABLED_STATUS = "DISABLED";

/**
 * Application service for Phase 2 Team/Permissions endpoints. Controllers
 * stay thin; all authorization/business rules live here (never in the
 * controller), mirroring the Phase 1 `IdentityService` convention.
 */
@Injectable()
export class TeamService {
  constructor(
    @Inject(TEAM_REPOSITORY) private readonly repository: TeamRepositoryPort,
    @Inject(GROUP_OWNERSHIP_PORT) private readonly groupOwnership: GroupOwnershipPort,
  ) {}

  async listTeam(workspaceContext: WorkspaceContext): Promise<ListTeamResponse> {
    const rows = await this.repository.listMembershipsForWorkspace(workspaceContext.workspaceId);
    return {
      members: rows.map((m) => ({
        id: m.id,
        userId: m.userId,
        roleLabel: m.roleLabel,
        status: m.status as "INVITED" | "ACTIVE" | "DISABLED",
      })),
    };
  }

  /**
   * Loads the target membership by id and asserts it belongs to the
   * caller's own (header-resolved) workspace. A membership from a foreign
   * workspace returns the same safe no-leak 404 as an unknown id.
   */
  private async loadTargetMembership(workspaceContext: WorkspaceContext, membershipId: string) {
    const target = await this.repository.findMembershipById(membershipId);
    if (!target || target.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    return target;
  }

  async updateMembershipPermissions(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    membershipId: string,
    body: unknown,
    correlationId: string | null,
  ): Promise<UpdateMembershipPermissionsResponse> {
    const target = await this.loadTargetMembership(workspaceContext, membershipId);

    const parsed = updateMembershipPermissionsRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationApiException(this.toFieldErrors(parsed.error));
    }

    // Phase 15D.1 — validate all SELECTED_GROUPS group ids in ONE query
    // instead of one RLS transaction PER group id (a per-item N+1). The
    // per-grant loop below is otherwise UNCHANGED — same coherence check,
    // same order, same PermissionScopeInvalidException (with the offending
    // groupId) for any id not in this workspace; it just tests membership
    // against this prefetched set rather than re-querying each id.
    const requestedGroupIds = [
      ...new Set(parsed.data.grants.flatMap((g) => (g.scope === "SELECTED_GROUPS" ? (g.groupIds ?? []) : []))),
    ];
    const validGroupIds = await this.groupOwnership.findGroupIdsInWorkspace(
      requestedGroupIds,
      workspaceContext.workspaceId,
    );

    const desiredGrants: DesiredGrantInput[] = [];
    for (const grant of parsed.data.grants) {
      this.assertCoherentGrant(grant.permission, grant.scope, target.roleLabel);

      if (grant.scope === "SELECTED_GROUPS") {
        for (const groupId of grant.groupIds ?? []) {
          if (!validGroupIds.has(groupId)) {
            throw new PermissionScopeInvalidException(
              "أحد المجموعات المحددة لا ينتمي إلى نفس مساحة العمل.",
              { groupId },
            );
          }
        }
      }

      desiredGrants.push({
        permissionKey: grant.permission,
        scopeType: grant.scope,
        groupIds: grant.groupIds,
      });
    }

    const { before, after } = await this.repository.replaceMembershipGrants({
      workspaceId: workspaceContext.workspaceId,
      membershipId: target.id,
      createdByUserId: authUser.id,
      desiredGrants,
    });

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "membership.permissions_updated",
      entityType: "membership",
      entityId: target.id,
      beforeJson: this.toSnapshot(before),
      afterJson: this.toSnapshot(after),
      correlationId,
    });

    return {
      membershipId: target.id,
      permissions: after.map((g) => ({
        permission: g.grant.permissionKey as PermissionKey,
        scope: g.grant.scopeType as "ALL_GROUPS" | "SELECTED_GROUPS",
        groupIds: g.grant.scopeType === "SELECTED_GROUPS" ? g.groupIds : undefined,
      })),
    };
  }

  async disableMembership(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    membershipId: string,
    correlationId: string | null,
  ): Promise<DisableMembershipResponse> {
    const target = await this.loadTargetMembership(workspaceContext, membershipId);

    // Phase 15D.1 — enforce the approved single-owner invariant
    // (`workspaces.owner_user_id NOT NULL`, one OWNER membership per
    // workspace, owner-only `team.manage`): the owner's own membership can
    // never be disabled (this also covers an owner attempting to self-disable
    // — the only membership an owner could target that is OWNER-role is their
    // own). Assistants remain fully disable-able. V1 has no ownership-transfer
    // command, so this is the only lockout-safe behaviour.
    if (target.roleLabel === OWNER_ROLE_LABEL) {
      throw new OwnerMembershipProtectedException();
    }

    const before = { status: target.status };

    const updated = await this.repository.disableMembership(target.id);

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "membership.disabled",
      entityType: "membership",
      entityId: target.id,
      beforeJson: before,
      afterJson: { status: updated.status, disabledAt: updated.disabledAt?.toISOString() ?? null },
      correlationId,
    });

    return {
      membershipId: updated.id,
      status: DISABLED_STATUS,
      disabledAt: (updated.disabledAt ?? new Date()).toISOString(),
    };
  }

  /**
   * Grant-time dependency/scope validation (Phase 2 spec §4):
   * - unknown scope kind mismatch (e.g. GROUP-only permission requested as
   *   ALL_GROUPS is fine — ALL_GROUPS is valid for GROUP-kind permissions;
   *   what's invalid is a WORKSPACE-kind permission requested with
   *   SELECTED_GROUPS, or vice versa is prevented by the contract schema).
   * - `team.manage` is Owner-only in V1 — rejected unconditionally for a
   *   non-owner target membership, regardless of who requests it.
   */
  private assertCoherentGrant(permission: PermissionKey, scope: "ALL_GROUPS" | "SELECTED_GROUPS", targetRoleLabel: string): void {
    if (OWNER_ONLY_PERMISSION_KEYS.has(permission) && targetRoleLabel !== OWNER_ROLE_LABEL) {
      throw new PermissionScopeInvalidException(
        "لا يمكن منح صلاحية إدارة الفريق (team.manage) لعضو ليس مالكًا لمساحة العمل.",
        { permission },
      );
    }

    const requiredKind = PERMISSION_SCOPE_KIND[permission];
    if (requiredKind === "WORKSPACE" && scope === "SELECTED_GROUPS") {
      throw new PermissionScopeInvalidException(
        `صلاحية "${permission}" على مستوى مساحة العمل ولا يمكن تحديد نطاقها بمجموعات.`,
        { permission, scope },
      );
    }
  }

  private toSnapshot(grants: GrantWithScopes[]) {
    return grants.map((g) => ({
      permission: g.grant.permissionKey,
      scope: g.grant.scopeType,
      groupIds: g.grant.scopeType === "SELECTED_GROUPS" ? g.groupIds : undefined,
    }));
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
