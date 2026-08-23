import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateCheckoutRequest,
  CreateCheckoutResponse,
  CreatePortalRequest,
  CreatePortalResponse,
  GetSubscriptionResponse,
  ListEntitlementsResponse,
  Subscription,
} from "@academic-precision/contracts";
import {
  mapPaddleEventToSubscriptionTransition,
  verifyPaddleWebhookSignature,
  type Capability,
  type PaddleWebhookEnvelope,
  type SubscriptionRow,
} from "@academic-precision/database";
import { loadServerEnv } from "@academic-precision/config";
import {
  ForbiddenApiException,
  ResourceNotFoundException,
  UnauthenticatedException,
  ValidationApiException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { BILLING_PROVIDER, type BillingProviderPort } from "./ports/billing-provider.port";
import { BILLING_REPOSITORY, type BillingRepositoryPort } from "./ports/billing-repository.port";

const OWNER_ROLE_LABEL = "OWNER";
const BILLING_WEBHOOK_OPERATION = "BILLING_WEBHOOK";
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Application service for Phase 8 Billing/Entitlements endpoints.
 * Controllers stay thin; all authorization/business rules live here,
 * mirroring the Phase 1-7 convention.
 *
 * ADR-014 / §11.16, enforced structurally, not just by convention:
 * `createCheckout`/`createPortal` NEVER write to `subscriptions`/
 * `entitlements` — the ONLY method in this whole class that does is
 * `handlePaddleWebhook`, and only after the signature has verified and the
 * event has been mapped to one of the 5 explicitly-approved transitions.
 * A checkout redirect landing back on the success page therefore cannot,
 * by construction, grant access on its own.
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(BILLING_REPOSITORY) private readonly repository: BillingRepositoryPort,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProviderPort,
  ) {}

  private assertOwner(workspaceContext: WorkspaceContext): void {
    if (workspaceContext.membership.roleLabel !== OWNER_ROLE_LABEL) {
      throw new ForbiddenApiException();
    }
  }

  // ---------------------------------------------------------------------
  // Billing (Owner only — deliberately NO @RequireEntitlement anywhere in
  // this section: "Billing/renewal endpoints remain accessible
  // independently of operational entitlements" is an explicit correction).
  // ---------------------------------------------------------------------

  async getSubscription(_authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<GetSubscriptionResponse> {
    this.assertOwner(workspaceContext);
    const subscription = await this.repository.findSubscriptionByWorkspaceId(workspaceContext.workspaceId);
    if (!subscription) throw new ResourceNotFoundException(); // defensive — every workspace gets one at provisioning
    return { subscription: this.toSubscriptionDto(subscription) };
  }

  async createCheckout(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: CreateCheckoutRequest,
  ): Promise<CreateCheckoutResponse> {
    this.assertOwner(workspaceContext);
    const result = await this.provider.createCheckoutSession({
      workspaceId: workspaceContext.workspaceId,
      customerEmail: authUser.email ?? null,
      returnUrl: body.returnUrl,
    });
    return { checkoutUrl: result.checkoutUrl };
  }

  async createPortal(
    _authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    body: CreatePortalRequest,
  ): Promise<CreatePortalResponse> {
    this.assertOwner(workspaceContext);
    const subscription = await this.repository.findSubscriptionByWorkspaceId(workspaceContext.workspaceId);
    if (!subscription?.providerCustomerId) {
      throw new ValidationApiException({ _root: ["لا يوجد عميل دفع مرتبط بعد بمساحة العمل — يلزم إكمال الدفع أولًا."] });
    }
    const result = await this.provider.createPortalSession({
      providerCustomerId: subscription.providerCustomerId,
      returnUrl: body.returnUrl,
    });
    return { portalUrl: result.portalUrl };
  }

  // ---------------------------------------------------------------------
  // Entitlements (any active membership — PermissionGuard's own no-
  // `@RequirePermission` fallback already requires ACTIVE status)
  // ---------------------------------------------------------------------

  async listEntitlements(_authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<ListEntitlementsResponse> {
    const rows = await this.repository.listCurrentEntitlementsForWorkspace(workspaceContext.workspaceId);
    return {
      entitlements: rows.map((r) => ({
        capability: r.capability as Capability,
        state: r.state as "ALLOWED" | "BLOCKED",
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Webhook — API Contract §11.16's exact 8-step pipeline. The controller
  // has already verified the signature is present/well-formed BEFORE
  // calling this (raw body capture happens at the HTTP layer — see
  // `webhooks.controller.ts`); this method re-verifies with the real
  // secret (the controller only checks the header is present — HERE is
  // where the actual HMAC/timestamp check happens, secret-bearing).
  // ---------------------------------------------------------------------

  async handlePaddleWebhook(rawBody: string, signatureHeader: string | undefined): Promise<void> {
    const { PADDLE_WEBHOOK_SECRET } = loadServerEnv();
    if (!PADDLE_WEBHOOK_SECRET) {
      throw new Error("PADDLE_WEBHOOK_SECRET is not configured — cannot verify webhook signatures.");
    }

    const verification = verifyPaddleWebhookSignature({ rawBody, signatureHeader, secret: PADDLE_WEBHOOK_SECRET });
    if (!verification.valid) {
      // §18 Security Contract: "لا trust للredirect" applies equally to an
      // unverifiable webhook — reject outright, never process.
      throw new UnauthenticatedException();
    }

    let envelope: PaddleWebhookEnvelope;
    try {
      envelope = JSON.parse(rawBody) as PaddleWebhookEnvelope;
    } catch {
      throw new ValidationApiException({ _root: ["Malformed webhook JSON body."] });
    }

    const workspaceId = envelope.data?.custom_data?.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      // No workspace to resolve (e.g. a customer-level event with no
      // subscription/custom_data yet) — safe, silent no-op ack. Never
      // guessed/looked-up cross-tenant (see billing-repository.port.ts's
      // own doc comment on why no such lookup exists).
      return;
    }

    const requestHash = createHash("sha256").update(rawBody).digest("hex");
    const existingRecord = await this.repository.findIdempotencyRecord(workspaceId, BILLING_WEBHOOK_OPERATION, envelope.event_id);
    if (existingRecord?.status === "COMPLETED") {
      return; // Already processed this exact provider event id — ack silently, no re-transition.
    }

    const idempotencyRow =
      existingRecord ??
      (await this.repository.tryInsertIdempotencyRecord({
        workspaceId,
        operation: BILLING_WEBHOOK_OPERATION,
        key: envelope.event_id,
        requestHash,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      })) ??
      (await this.repository.findIdempotencyRecord(workspaceId, BILLING_WEBHOOK_OPERATION, envelope.event_id));

    if (!idempotencyRow) {
      throw new Error("Failed to record Paddle webhook idempotency.");
    }
    if (idempotencyRow.status === "COMPLETED") {
      return;
    }

    const transition = mapPaddleEventToSubscriptionTransition(envelope);
    if (!transition) {
      // Not one of the 5 explicitly-approved subscription-level
      // transitions (includes transaction.completed/payment_failed, which
      // are never authoritative on their own) — still record as
      // completed, so a retry of this exact event id is a guaranteed no-op.
      await this.repository.completeIdempotencyRecord(idempotencyRow.id, 200, { noop: true, eventType: envelope.event_type });
      return;
    }

    const subscription = await this.repository.findSubscriptionByWorkspaceId(workspaceId);
    if (!subscription) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new Error(`No subscription row found for workspace ${workspaceId} while processing a Paddle webhook.`);
    }

    const result = await this.repository.updateSubscriptionStateTransaction({
      id: subscription.id,
      workspaceId,
      expectedVersion: subscription.version,
      nextState: transition.nextState,
      periodStart: transition.periodStart,
      periodEnd: transition.periodEnd,
      cancelAtPeriodEnd: transition.cancelAtPeriodEnd,
      providerSubscriptionId: transition.providerSubscriptionId,
      providerCustomerId: transition.providerCustomerId,
      sourceType: "SUBSCRIPTION",
      sourceId: envelope.event_id,
      actorUserId: null,
      actorMembershipId: null,
      correlationId: envelope.event_id,
    });

    if (result === "SUBSCRIPTION_VERSION_CONFLICT") {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      // §11.16 step 8: "return 2xx only after durable commit" — a version
      // conflict means nothing committed, so this must NOT return 2xx;
      // propagating lets Paddle's own webhook retry policy try again.
      throw new Error(`Subscription version conflict while processing Paddle webhook ${envelope.event_id} — will retry.`);
    }

    await this.repository.completeIdempotencyRecord(idempotencyRow.id, 200, {
      subscriptionId: subscription.id,
      state: transition.nextState,
    });
  }

  private toSubscriptionDto(row: SubscriptionRow): Subscription {
    return {
      id: row.id,
      provider: row.provider,
      state: row.state as Subscription["state"],
      periodStart: row.periodStart ? row.periodStart.toISOString() : null,
      periodEnd: row.periodEnd ? row.periodEnd.toISOString() : null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      version: row.version,
    };
  }
}
