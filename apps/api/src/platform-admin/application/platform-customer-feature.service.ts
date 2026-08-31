import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  claimCustomerInvitationTx,
  createCustomerInvitation,
  findCustomerInvitationById,
  findGlobalFlagStates,
  findPrimaryOwnedWorkspaceId,
  listActiveFeatureOverrides,
  listCustomerInvitations,
  previewCustomerInvitation,
  revokeCustomerInvitation,
  revokeFeatureOverride,
  setFeatureOverride,
} from "@academic-precision/database";
import {
  PLATFORM_FEATURE_CATALOG,
  PLATFORM_FEATURE_KEYS,
  createCustomerInvitationRequestSchema,
  revokeFeatureOverrideRequestSchema,
  setFeatureOverrideRequestSchema,
  type ClaimCustomerInvitationResponse,
  type CreateCustomerInvitationResponse,
  type CustomerInvitationPreview,
  type ListCustomerInvitationsResponse,
  type ListWorkspaceFeaturesResponse,
} from "@academic-precision/contracts";
import type { z, ZodTypeAny } from "zod";
import { ForbiddenApiException, InvitationInvalidException, ResourceNotFoundException, ValidationApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";

const DEFAULT_EXPIRES_IN_DAYS = 14;

/**
 * Customer Creation via Secure Invite + Workspace Feature Overrides.
 * Authorization is enforced at the controller (`platform.customers.manage` for
 * customer invites, `platform.features.manage` for overrides); this layer
 * validates input and maps rows/sentinels to HTTP. The customer invite never
 * provisions anything — the customer's own workspace + trial come from the
 * existing lazy provisioning when they first sign in.
 */
@Injectable()
export class PlatformCustomerFeatureService {
  // --- Customer invitations -------------------------------------------------
  async listCustomerInvitations(cursor?: string, limit?: number): Promise<ListCustomerInvitationsResponse> {
    const result = await listCustomerInvitations({ cursor, limit });
    return {
      items: result.items.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        email: r.email,
        phone: r.phone,
        status: r.status as "PENDING" | "ACCEPTED" | "REVOKED",
        invitedByName: r.invitedByName,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
        acceptedWorkspaceId: r.acceptedWorkspaceId,
        expired: r.status === "PENDING" && r.expiresAt.getTime() <= Date.now(),
      })),
      page: { nextCursor: result.nextCursor, hasNext: result.hasNext },
    };
  }

  async createCustomerInvitation(actor: VerifiedSupabaseToken, body: unknown): Promise<CreateCustomerInvitationResponse> {
    const parsed = this.parse(createCustomerInvitationRequestSchema, body);
    const rawToken = this.generateRawToken();
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);
    const { id } = await createCustomerInvitation({
      fullName: parsed.fullName,
      email: parsed.email,
      phone: parsed.phone ?? null,
      tokenHash: this.hashToken(rawToken),
      invitedByUserId: actor.id,
      expiresAt,
    });
    return { id, token: rawToken, expiresAt: expiresAt.toISOString() };
  }

  async revokeCustomerInvitation(actor: VerifiedSupabaseToken, id: string): Promise<{ id: string; status: "REVOKED" }> {
    const target = await findCustomerInvitationById(id);
    if (!target) throw new ResourceNotFoundException();
    const ok = await revokeCustomerInvitation(id, actor.id);
    if (!ok) throw new ResourceNotFoundException("لا يمكن إلغاء هذه الدعوة في حالتها الحالية.");
    return { id, status: "REVOKED" };
  }

  async previewCustomerInvitation(rawToken: string): Promise<CustomerInvitationPreview> {
    const preview = await previewCustomerInvitation(this.hashToken(rawToken));
    if (!preview) throw new InvitationInvalidException();
    return { valid: preview.valid, status: preview.status, fullName: preview.fullName, email: preview.email, expiresAt: preview.expiresAt };
  }

  async claimCustomerInvitation(authUser: VerifiedSupabaseToken, rawToken: string): Promise<ClaimCustomerInvitationResponse> {
    // Resolve the caller's OWN provisioned workspace server-side (never trust a
    // client-supplied id). It may be null if provisioning hasn't run yet.
    const workspaceId = await findPrimaryOwnedWorkspaceId(authUser.id);
    const result = await claimCustomerInvitationTx({
      tokenHash: this.hashToken(rawToken),
      accepterUserId: authUser.id,
      accepterEmail: authUser.email ?? null,
      workspaceId,
    });
    if (!result.ok) {
      if (result.reason === "EMAIL_MISMATCH") throw new ForbiddenApiException("هذه الدعوة مخصّصة لبريد مختلف. سجّل الدخول بالبريد المدعو.");
      throw new InvitationInvalidException();
    }
    return { status: "ACCEPTED", workspaceId: result.workspaceId };
  }

  // --- Feature overrides ----------------------------------------------------
  async listWorkspaceFeatures(workspaceId: string): Promise<ListWorkspaceFeaturesResponse> {
    const [globals, overrides] = await Promise.all([findGlobalFlagStates(PLATFORM_FEATURE_KEYS), listActiveFeatureOverrides(workspaceId)]);
    const overrideByKey = new Map(overrides.map((o) => [o.featureKey, o]));
    return {
      items: PLATFORM_FEATURE_CATALOG.map((f) => {
        const globalEnabled = globals.get(f.key) ?? false;
        const ov = overrideByKey.get(f.key);
        const effectiveEnabled = ov ? ov.state === "ENABLED" : globalEnabled;
        return {
          key: f.key,
          label: f.label,
          description: f.description,
          globalEnabled,
          effectiveEnabled,
          override: ov
            ? {
                state: ov.state,
                reason: ov.reason,
                createdByName: ov.createdByName,
                createdAt: ov.createdAt.toISOString(),
                expiresAt: ov.expiresAt ? ov.expiresAt.toISOString() : null,
              }
            : null,
        };
      }),
    };
  }

  async setFeatureOverride(workspaceId: string, actor: VerifiedSupabaseToken, body: unknown): Promise<{ featureKey: string; state: string }> {
    const parsed = this.parse(setFeatureOverrideRequestSchema, body);
    await setFeatureOverride({
      workspaceId,
      featureKey: parsed.featureKey,
      state: parsed.state,
      reason: parsed.reason,
      actorUserId: actor.id,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
    });
    return { featureKey: parsed.featureKey, state: parsed.state };
  }

  async revokeFeatureOverride(workspaceId: string, actor: VerifiedSupabaseToken, body: unknown): Promise<{ featureKey: string }> {
    const parsed = this.parse(revokeFeatureOverrideRequestSchema, body);
    const ok = await revokeFeatureOverride({ workspaceId, featureKey: parsed.featureKey, actorUserId: actor.id, reason: parsed.reason });
    if (!ok) throw new ResourceNotFoundException("لا يوجد تجاوز نشِط لهذه الميزة.");
    return { featureKey: parsed.featureKey };
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
