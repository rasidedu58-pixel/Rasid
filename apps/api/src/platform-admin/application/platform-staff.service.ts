import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  acceptStaffInvitationTx,
  changePlatformStaffRole,
  createStaffInvitation,
  ensureApplicationUser,
  findStaffInvitationById,
  listPlatformStaffMembers,
  listStaffInvitations,
  previewStaffInvitation,
  revokeStaffInvitation,
  setPlatformStaffStatus,
} from "@academic-precision/database";
import {
  changePlatformStaffRoleRequestSchema,
  createPlatformStaffInvitationRequestSchema,
  platformStaffAccountActionRequestSchema,
  type AcceptPlatformStaffInvitationResponse,
  type CreatePlatformStaffInvitationResponse,
  type ListPlatformStaffInvitationsResponse,
  type ListPlatformStaffMembersResponse,
  type PlatformRole,
  type PlatformStaffInvitationPreview,
} from "@academic-precision/contracts";
import type { z, ZodTypeAny } from "zod";
import {
  ForbiddenApiException,
  InvitationInvalidException,
  PlatformStaffProtectedException,
  ResourceNotFoundException,
  ValidationApiException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";

const DEFAULT_EXPIRES_IN_DAYS = 7;

/**
 * Platform Staff Management ("فريق راصد") — OWNER-only. Authorization
 * (`platform.staff.manage`) is enforced by the controller guards; this layer
 * validates input, adds self-protection (an owner cannot change their own role
 * or disable themselves — a second owner must), and maps repo results/sentinels
 * to HTTP. The last-active-owner invariant is enforced in the repository
 * transaction (data-integrity backstop) and surfaced here as 409.
 */
@Injectable()
export class PlatformStaffService {
  async listStaff(caller: VerifiedSupabaseToken): Promise<ListPlatformStaffMembersResponse> {
    const rows = await listPlatformStaffMembers();
    return {
      items: rows.map((r) => ({
        userId: r.userId,
        fullName: r.fullName,
        email: r.email,
        role: r.role as PlatformRole,
        status: r.status,
        invitedByName: r.invitedByName,
        grantedAt: r.grantedAt.toISOString(),
        isSelf: r.userId === caller.id,
      })),
    };
  }

  async listInvitations(): Promise<ListPlatformStaffInvitationsResponse> {
    const rows = await listStaffInvitations();
    return {
      items: rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role as PlatformRole,
        status: r.status as "PENDING" | "ACCEPTED" | "REVOKED",
        invitedByName: null,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
        expired: r.status === "PENDING" && r.expiresAt.getTime() <= Date.now(),
      })),
    };
  }

  async createInvitation(actor: VerifiedSupabaseToken, body: unknown): Promise<CreatePlatformStaffInvitationResponse> {
    const parsed = this.parse(createPlatformStaffInvitationRequestSchema, body);
    const rawToken = this.generateRawToken();
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
    const { id } = await createStaffInvitation({
      email: parsed.email,
      role: parsed.role,
      tokenHash: this.hashToken(rawToken),
      invitedByUserId: actor.id,
      expiresAt,
    });
    return { id, token: rawToken, expiresAt: expiresAt.toISOString() };
  }

  async revokeInvitation(actor: VerifiedSupabaseToken, id: string): Promise<{ id: string; status: "REVOKED" }> {
    const target = await findStaffInvitationById(id);
    if (!target) throw new ResourceNotFoundException();
    const ok = await revokeStaffInvitation(id, actor.id);
    if (!ok) throw new ResourceNotFoundException("لا يمكن إلغاء هذه الدعوة في حالتها الحالية.");
    return { id, status: "REVOKED" };
  }

  async previewInvitation(rawToken: string): Promise<PlatformStaffInvitationPreview> {
    const preview = await previewStaffInvitation(this.hashToken(rawToken));
    if (!preview) throw new InvitationInvalidException();
    return {
      valid: preview.valid,
      status: preview.status,
      email: preview.email,
      role: preview.role as PlatformRole,
      invitedByName: preview.invitedByName,
      expiresAt: preview.expiresAt,
    };
  }

  async acceptInvitation(authUser: VerifiedSupabaseToken, rawToken: string): Promise<AcceptPlatformStaffInvitationResponse> {
    // Ensure ONLY the application `users` row exists (identity from the verified
    // JWT) so the platform_admins FK is satisfied — WITHOUT tenant provisioning:
    // a staff member must never get a teaching workspace / owner membership /
    // trial just by joining فريق راصد. Idempotent for an existing user.
    await ensureApplicationUser({
      authUserId: authUser.id,
      email: authUser.email ?? null,
      fullName: this.deriveName(authUser.email),
    });
    const result = await acceptStaffInvitationTx({
      tokenHash: this.hashToken(rawToken),
      accepterUserId: authUser.id,
      accepterEmail: authUser.email ?? null,
    });
    if (!result.ok) {
      if (result.reason === "ALREADY_ADMIN") throw new ForbiddenApiException("أنت بالفعل ضمن فريق المنصة.");
      if (result.reason === "EMAIL_MISMATCH") throw new ForbiddenApiException("هذه الدعوة مخصّصة لبريد مختلف. سجّل الدخول بالبريد المدعو.");
      throw new InvitationInvalidException();
    }
    return { role: result.role as PlatformRole, status: "ACTIVE" };
  }

  async changeRole(actor: VerifiedSupabaseToken, targetUserId: string, body: unknown): Promise<{ userId: string; role: PlatformRole }> {
    const parsed = this.parse(changePlatformStaffRoleRequestSchema, body);
    if (targetUserId === actor.id) {
      throw new PlatformStaffProtectedException("لا يمكنك تغيير دورك بنفسك — يجب أن يقوم بذلك مالك آخر.");
    }
    const result = await changePlatformStaffRole({ targetUserId, newRole: parsed.role, actorUserId: actor.id, reason: parsed.reason });
    if (!result.ok) {
      if (result.reason === "LAST_OWNER") throw new PlatformStaffProtectedException("لا يمكن خفض دور آخر مالك نشِط للمنصة.");
      throw new ResourceNotFoundException();
    }
    return { userId: targetUserId, role: result.role as PlatformRole };
  }

  async accountAction(actor: VerifiedSupabaseToken, targetUserId: string, body: unknown): Promise<{ userId: string; status: "ACTIVE" | "DISABLED" }> {
    const parsed = this.parse(platformStaffAccountActionRequestSchema, body);
    if (targetUserId === actor.id) {
      throw new PlatformStaffProtectedException("لا يمكنك تعطيل حسابك بنفسك — يجب أن يقوم بذلك مالك آخر.");
    }
    const result = await setPlatformStaffStatus({ targetUserId, action: parsed.action, actorUserId: actor.id, reason: parsed.reason });
    if (!result.ok) {
      if (result.reason === "LAST_OWNER") throw new PlatformStaffProtectedException("لا يمكن تعطيل آخر مالك نشِط للمنصة.");
      throw new ResourceNotFoundException();
    }
    return { userId: targetUserId, status: result.status };
  }

  /** Minimal display name from the verified JWT email (never client-supplied). */
  private deriveName(email: string | null): string {
    const local = email?.split("@")[0]?.trim();
    return local && local.length > 0 ? local : "عضو فريق راصد";
  }

  private generateRawToken(): string {
    return randomBytes(32).toString("base64url");
  }
  private hashToken(rawToken: string): string {
    return createHash("sha256").update(rawToken).digest("hex");
  }
  private parse<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
    const result = schema.safeParse(body);
    if (!result.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
        fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
      }
      throw new ValidationApiException(fieldErrors);
    }
    return result.data;
  }
}
