import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  PERMISSION_SCOPE_KIND,
  OWNER_ONLY_PERMISSION_KEYS,
  createInvitationRequestSchema,
  createTeamMemberRequestSchema,
  type AcceptInvitationResponse,
  type CreateInvitationResponse,
  type CreateTeamMemberResponse,
  type DesiredGrant,
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
import { AUTH_ADMIN_PORT, type AuthAdminPort } from "./ports/auth-admin.port";
import { GROUP_OWNERSHIP_PORT, type GroupOwnershipPort } from "./ports/group-ownership.port";
import { INVITATION_REPOSITORY, type InvitationRepositoryPort } from "./ports/invitation-repository.port";
import { TEAM_REPOSITORY, type TeamRepositoryPort } from "./ports/team-repository.port";

/** Every invited member is a non-owner; the display role is derived from grants. */
const MEMBER_ROLE_LABEL = "MEMBER";

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
    @Inject(AUTH_ADMIN_PORT) private readonly authAdmin: AuthAdminPort,
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

    const desiredGrants = await this.toValidatedGrants(workspaceContext, parsed.data.grants);
    const invitation = await this.insertInvitation({
      authUser,
      workspaceContext,
      desiredGrants,
      invitedLabel: parsed.data.invitedLabel ?? null,
      action: "invitation.created",
      correlationId,
    });

    return { id: invitation.id, token: invitation.token, status: "PENDING", expiresAt: null };
  }

  /**
   * Creates the member's SIGN-IN ACCOUNT and their invitation in one owner
   * action: the owner decides the email, the password and the permissions,
   * then hands over the link.
   *
   * Password handling, spelled out because it is the sensitive part: the
   * password goes from this request straight to the auth provider's admin
   * API and is referenced nowhere else. Rasid keeps no copy — no column, no
   * log, no response — and no endpoint can read it back. The owner knows it
   * because they chose it. That is the entire mechanism, and it is why there
   * is no vault here and nothing to leak later.
   *
   * An email that ALREADY has an account is a normal outcome, not an error:
   * no second user is created, and the existing account's password is never
   * overwritten — otherwise any workspace owner could seize an account just
   * by knowing its address. The invitation is still created and the response
   * says `account: "EXISTING"`, so the owner tells that person to sign in
   * with the password they already have. Identity stays with the person;
   * only the membership is being offered.
   */
  async createTeamMember(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: unknown,
    correlationId: string | null,
  ): Promise<CreateTeamMemberResponse> {
    const parsed = createTeamMemberRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationApiException(this.toFieldErrors(parsed.error));
    }
    const { fullName, email, password, grants } = parsed.data;

    if (!this.authAdmin.isConfigured()) {
      // A deployment with no admin credential cannot create accounts. Say so
      // plainly rather than half-failing — the link-only invite still works.
      throw new ValidationApiException({
        _root: [
          "إنشاء حساب للعضو غير مفعّل على هذا الخادم. استخدم رابط الدعوة ليُنشئ العضو حسابه بنفسه، أو اضبط SUPABASE_SERVICE_ROLE_KEY.",
        ],
      });
    }

    // Validate the permissions BEFORE touching the auth provider, so a
    // rejected grant can never leave an orphan account behind.
    const desiredGrants = await this.toValidatedGrants(workspaceContext, grants);

    const created = await this.authAdmin.createUser({ email, password, fullName });
    let account: CreateTeamMemberResponse["account"];
    if (created.ok) {
      account = "CREATED";
    } else if (created.reason === "EMAIL_TAKEN") {
      account = "EXISTING";
    } else if (created.reason === "WEAK_PASSWORD") {
      throw new ValidationApiException({ password: ["كلمة المرور مرفوضة من نظام الدخول — اختر كلمة أقوى."] });
    } else {
      throw new ValidationApiException({ _root: ["تعذّر الوصول إلى نظام الدخول لإنشاء الحساب. حاول مرة أخرى."] });
    }

    const invitation = await this.insertInvitation({
      authUser,
      workspaceContext,
      desiredGrants,
      invitedLabel: `${fullName} · ${email}`,
      action: "team_member.created",
      correlationId,
    });

    return { invitationId: invitation.id, token: invitation.token, email, account };
  }

  /**
   * Same coherence + workspace-ownership validation the permission editor
   * runs: the target is a non-owner MEMBER, so `team.manage` is rejected, and
   * every SELECTED_GROUPS id must belong to this workspace. Shared by both
   * create paths so neither can drift into trusting the client.
   */
  private async toValidatedGrants(
    workspaceContext: WorkspaceContext,
    grants: DesiredGrant[],
  ): Promise<InvitationDesiredGrant[]> {
    const requestedGroupIds = [
      ...new Set(grants.flatMap((g) => (g.scope === "SELECTED_GROUPS" ? (g.groupIds ?? []) : []))),
    ];
    const validGroupIds = await this.groupOwnership.findGroupIdsInWorkspace(
      requestedGroupIds,
      workspaceContext.workspaceId,
    );

    const desiredGrants: InvitationDesiredGrant[] = [];
    for (const grant of grants) {
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
    return desiredGrants;
  }

  /** Mints the token, stores only its hash, and audits — with NO expiry (see migration 0076). */
  private async insertInvitation(params: {
    authUser: VerifiedSupabaseToken;
    workspaceContext: WorkspaceContext;
    desiredGrants: InvitationDesiredGrant[];
    invitedLabel: string | null;
    action: string;
    correlationId: string | null;
  }): Promise<{ id: string; token: string }> {
    const rawToken = this.generateRawToken();
    const invitation = await this.repository.createInvitation({
      workspaceId: params.workspaceContext.workspaceId,
      tokenHash: this.hashToken(rawToken),
      roleLabel: MEMBER_ROLE_LABEL,
      desiredGrants: params.desiredGrants,
      invitedLabel: params.invitedLabel,
      invitedByUserId: params.authUser.id,
      // An invitation ends by being accepted or revoked — never on a clock.
      expiresAt: null,
    });

    await this.teamRepository.insertAuditEvent({
      workspaceId: params.workspaceContext.workspaceId,
      actorUserId: params.authUser.id,
      actorMembershipId: params.workspaceContext.membership.id,
      action: params.action,
      entityType: "invitation",
      entityId: invitation.id,
      // Never the raw token, its hash, or any password — only non-secret
      // metadata. `invitedLabel` is the owner's own note.
      afterJson: { roleLabel: MEMBER_ROLE_LABEL, grantsCount: params.desiredGrants.length, invitedLabel: params.invitedLabel },
      correlationId: params.correlationId,
    });

    return { id: invitation.id, token: rawToken };
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
      invitedLabel: preview.invitedLabel,
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
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      // Only a legacy row can still be expired; new invitations have no deadline.
      expired: row.status === "PENDING" && row.expiresAt !== null && row.expiresAt.getTime() <= Date.now(),
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
