import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  PERMISSION_SCOPE_KIND,
  OWNER_ONLY_PERMISSION_KEYS,
  createInvitationRequestSchema,
  type AcceptInvitationResponse,
  type CreateInvitationResponse,
  type InvitationPreviewResponse,
  type InvitationSummary,
  type ListInvitationsResponse,
  type PermissionKey,
  type RevokeInvitationResponse,
} from "@academic-precision/contracts";
import type { InvitationDesiredGrant, InvitationRow } from "@academic-precision/database";
import type { ZodError } from "zod";
import {
  AlreadyMemberException,
  InvitationInvalidException,
  PermissionScopeInvalidException,
  ResourceNotFoundException,
  ValidationApiException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../api/guards/permission.guard";
import { GROUP_OWNERSHIP_PORT, type GroupOwnershipPort } from "./ports/group-ownership.port";
import { INVITATION_REPOSITORY, type InvitationRepositoryPort } from "./ports/invitation-repository.port";
import { TEAM_REPOSITORY, type TeamRepositoryPort } from "./ports/team-repository.port";

/** Every invited member is a non-owner; the display role is derived from grants. */
const MEMBER_ROLE_LABEL = "MEMBER";
const DEFAULT_EXPIRES_IN_DAYS = 7;

/**
 * Team & Permissions Phase 2 — invitation-link service. Owner-facing
 * create/list/revoke are workspace-scoped and re-validate every grant exactly
 * as the permission editor's path does (never trusting the client). The
 * invitee-facing preview/accept take only a raw token; the raw token is
 * hashed here and never logged or stored.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(INVITATION_REPOSITORY) private readonly repository: InvitationRepositoryPort,
    @Inject(GROUP_OWNERSHIP_PORT) private readonly groupOwnership: GroupOwnershipPort,
    @Inject(TEAM_REPOSITORY) private readonly teamRepository: TeamRepositoryPort,
  ) {}

  async createInvitation(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: unknown,
    correlationId: string | null,
  ): Promise<CreateInvitationResponse> {
    const parsed = createInvitationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationApiException(this.toFieldErrors(parsed.error));
    }

    // Same coherence + workspace-ownership validation as updateMembershipPermissions:
    // the target is a non-owner MEMBER, so team.manage is rejected, and every
    // SELECTED_GROUPS id must belong to this workspace.
    const requestedGroupIds = [
      ...new Set(parsed.data.grants.flatMap((g) => (g.scope === "SELECTED_GROUPS" ? (g.groupIds ?? []) : []))),
    ];
    const validGroupIds = await this.groupOwnership.findGroupIdsInWorkspace(
      requestedGroupIds,
      workspaceContext.workspaceId,
    );

    const desiredGrants: InvitationDesiredGrant[] = [];
    for (const grant of parsed.data.grants) {
      this.assertCoherentGrant(grant.permission, grant.scope);
      if (grant.scope === "SELECTED_GROUPS") {
        for (const groupId of grant.groupIds ?? []) {
          if (!validGroupIds.has(groupId)) {
            throw new PermissionScopeInvalidException("أحد المجموعات المحددة لا ينتمي إلى نفس مساحة العمل.", { groupId });
          }
        }
      }
      desiredGrants.push({ permissionKey: grant.permission, scopeType: grant.scope, groupIds: grant.groupIds });
    }

    const rawToken = this.generateRawToken();
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + (parsed.data.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS) * 24 * 60 * 60 * 1000);

    const invitation = await this.repository.createInvitation({
      workspaceId: workspaceContext.workspaceId,
      tokenHash,
      roleLabel: MEMBER_ROLE_LABEL,
      desiredGrants,
      invitedLabel: parsed.data.invitedLabel ?? null,
      invitedByUserId: authUser.id,
      expiresAt,
    });

    await this.teamRepository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "invitation.created",
      entityType: "invitation",
      entityId: invitation.id,
      // Never log the raw token or its hash; record only non-secret metadata.
      afterJson: { roleLabel: MEMBER_ROLE_LABEL, expiresAt: expiresAt.toISOString(), grantsCount: desiredGrants.length },
      correlationId,
    });

    return { id: invitation.id, token: rawToken, status: "PENDING", expiresAt: expiresAt.toISOString() };
  }

  async listInvitations(workspaceContext: WorkspaceContext): Promise<ListInvitationsResponse> {
    const rows = await this.repository.listInvitations(workspaceContext.workspaceId);
    return { invitations: rows.map((row) => this.toSummary(row)) };
  }

  async revokeInvitation(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    invitationId: string,
    correlationId: string | null,
  ): Promise<RevokeInvitationResponse> {
    // Safe no-leak: a foreign/unknown invitation is invisible under RLS and
    // returns the same 404 as one that never existed.
    const target = await this.repository.findInvitationById(invitationId);
    if (!target || target.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }

    const revoked = await this.repository.revokeInvitation(invitationId);
    if (!revoked) {
      // Already accepted or already revoked — nothing to revoke.
      throw new ResourceNotFoundException("لا يمكن إلغاء هذه الدعوة في حالتها الحالية.");
    }

    await this.teamRepository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "invitation.revoked",
      entityType: "invitation",
      entityId: invitationId,
      correlationId,
    });

    return { id: invitationId, status: "REVOKED" };
  }

  async previewInvitation(authUser: VerifiedSupabaseToken, rawToken: string): Promise<InvitationPreviewResponse> {
    const preview = await this.repository.previewInvitation(this.hashToken(rawToken), authUser.id);
    if (!preview) {
      throw new InvitationInvalidException();
    }
    return {
      status: preview.status,
      valid: preview.valid,
      workspaceId: preview.workspaceId,
      workspaceName: preview.workspaceName,
      expiresAt: preview.expiresAt,
      permissions: preview.desiredGrants.map((g) => g.permissionKey as PermissionKey),
    };
  }

  async acceptInvitation(authUser: VerifiedSupabaseToken, rawToken: string): Promise<AcceptInvitationResponse> {
    const result = await this.repository.acceptInvitation({
      tokenHash: this.hashToken(rawToken),
      accepterUserId: authUser.id,
    });
    if (!result.ok) {
      if (result.reason === "ALREADY_MEMBER") throw new AlreadyMemberException();
      throw new InvitationInvalidException();
    }
    return { workspaceId: result.workspaceId, membershipId: result.membershipId, status: "ACTIVE" };
  }

  private toSummary(row: InvitationRow): InvitationSummary {
    return {
      id: row.id,
      status: row.status as InvitationSummary["status"],
      invitedLabel: row.invitedLabel,
      roleLabel: row.roleLabel,
      grants: row.desiredGrants.map((g) => ({
        permission: g.permissionKey as PermissionKey,
        scope: g.scopeType,
        groupIds: g.scopeType === "SELECTED_GROUPS" ? g.groupIds : undefined,
      })),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      expired: row.status === "PENDING" && row.expiresAt.getTime() <= Date.now(),
    };
  }

  /** Mirrors `TeamService.assertCoherentGrant` for the invited (non-owner) target. */
  private assertCoherentGrant(permission: PermissionKey, scope: "ALL_GROUPS" | "SELECTED_GROUPS"): void {
    if (OWNER_ONLY_PERMISSION_KEYS.has(permission)) {
      throw new PermissionScopeInvalidException(
        "لا يمكن منح صلاحية إدارة الفريق (team.manage) عبر دعوة — إنها للمالك فقط.",
        { permission },
      );
    }
    if (PERMISSION_SCOPE_KIND[permission] === "WORKSPACE" && scope === "SELECTED_GROUPS") {
      throw new PermissionScopeInvalidException(
        `صلاحية "${permission}" على مستوى مساحة العمل ولا يمكن تحديد نطاقها بمجموعات.`,
        { permission, scope },
      );
    }
  }

  /** 32 random bytes, URL-safe — the shareable secret. Never persisted raw. */
  private generateRawToken(): string {
    return randomBytes(32).toString("base64url");
  }

  /** SHA-256 hex digest — the ONLY form ever stored or compared. */
  private hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
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
