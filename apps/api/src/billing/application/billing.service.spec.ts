import { createHmac, randomUUID } from "node:crypto";
import type { MembershipRow } from "@academic-precision/database";
import { ForbiddenApiException, UnauthenticatedException, ValidationApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { InMemoryBillingRepository } from "./__fixtures__/in-memory-billing.repository";
import { FakeBillingProvider } from "./__fixtures__/fake-billing.provider";
import { BillingService } from "./billing.service";

const WORKSPACE_A = "workspace-a";
const WEBHOOK_SECRET = "test-webhook-secret";

function sign(rawBody: string, tsSeconds: number, secret = WEBHOOK_SECRET): string {
  const hmac = createHmac("sha256", secret).update(`${tsSeconds}:${rawBody}`, "utf8").digest("hex");
  return `ts=${tsSeconds};h1=${hmac}`;
}

function membership(overrides: Partial<MembershipRow> = {}): MembershipRow {
  const now = new Date();
  return {
    id: randomUUID(),
    workspaceId: WORKSPACE_A,
    userId: "u-owner",
    roleLabel: "OWNER",
    status: "ACTIVE",
    joinedAt: now,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("BillingService", () => {
  let repo: InMemoryBillingRepository;
  let provider: FakeBillingProvider;
  let service: BillingService;

  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    repo = new InMemoryBillingRepository();
    provider = new FakeBillingProvider();
    service = new BillingService(repo, provider);

    owner = { id: "u-owner", email: "owner@example.com" };
    ownerContext = { workspaceId: WORKSPACE_A, membership: membership() };

    process.env.PADDLE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.PADDLE_WEBHOOK_SECRET;
  });

  // ---------------------------------------------------------------------
  // checkout redirect alone does not grant access
  // ---------------------------------------------------------------------

  it("createCheckout never writes Subscription/Entitlement state — only returns a URL", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "EXPIRED" });

    const result = await service.createCheckout(owner, ownerContext, { returnUrl: "https://app.example.com/billing/return" });
    expect(result.checkoutUrl).toMatch(/^https:\/\/fake-paddle\.test\/checkout\//);
    expect(provider.checkoutCalls).toHaveLength(1);
    expect(provider.checkoutCalls[0]!.workspaceId).toBe(WORKSPACE_A);

    // Still EXPIRED — the checkout call itself changed nothing.
    const subscription = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(subscription!.state).toBe("EXPIRED");
    const entitlements = await repo.listCurrentEntitlementsForWorkspace(WORKSPACE_A);
    expect(entitlements.every((e) => e.state === "BLOCKED")).toBe(true);
  });

  it("createCheckout/createPortal are Owner-only", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "ACTIVE", providerCustomerId: "ctm_1" });
    const assistantContext: WorkspaceContext = { workspaceId: WORKSPACE_A, membership: membership({ roleLabel: "ASSISTANT" }) };

    await expect(service.createCheckout(owner, assistantContext, { returnUrl: "https://x.test" })).rejects.toBeInstanceOf(
      ForbiddenApiException,
    );
    await expect(service.createPortal(owner, assistantContext, { returnUrl: "https://x.test" })).rejects.toBeInstanceOf(
      ForbiddenApiException,
    );
  });

  it("billing endpoints remain reachable regardless of subscription state (Expired workspace can still checkout)", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "EXPIRED" });
    const result = await service.getSubscription(owner, ownerContext);
    expect(result.subscription.state).toBe("EXPIRED");
    // No throw — billing/renewal availability is independent of operational entitlements.
    await expect(service.createCheckout(owner, ownerContext, { returnUrl: "https://x.test" })).resolves.toBeDefined();
  });

  it("createPortal requires an existing provider customer id (post-checkout)", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "TRIAL", providerCustomerId: null });
    await expect(service.createPortal(owner, ownerContext, { returnUrl: "https://x.test" })).rejects.toBeInstanceOf(
      ValidationApiException,
    );
  });

  // ---------------------------------------------------------------------
  // webhook: signature / idempotency / state transitions
  // ---------------------------------------------------------------------

  function webhookBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      event_id: `evt_${randomUUID()}`,
      event_type: "subscription.activated",
      data: { id: "sub_1", customer_id: "ctm_1", custom_data: { workspaceId: WORKSPACE_A } },
      ...overrides,
    });
  }

  it("forged webhook (wrong secret) is rejected — no state change, no idempotency record left", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "TRIAL" });
    const rawBody = webhookBody();
    const forgedHeader = sign(rawBody, Math.floor(Date.now() / 1000), "wrong-secret");

    await expect(service.handlePaddleWebhook(rawBody, forgedHeader)).rejects.toBeInstanceOf(UnauthenticatedException);

    const subscription = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(subscription!.state).toBe("TRIAL"); // unchanged
    expect(repo.idempotencyById.size).toBe(0);
  });

  it("subscription.activated transitions TRIAL -> ACTIVE and records provider ids", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "TRIAL" });
    const rawBody = webhookBody();
    const header = sign(rawBody, Math.floor(Date.now() / 1000));

    await service.handlePaddleWebhook(rawBody, header);

    const subscription = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(subscription!.state).toBe("ACTIVE");
    expect(subscription!.providerSubscriptionId).toBe("sub_1");
    const entitlements = await repo.listCurrentEntitlementsForWorkspace(WORKSPACE_A);
    expect(entitlements.every((e) => e.state === "ALLOWED")).toBe(true);
  });

  it("a duplicated webhook (same event_id replayed) does not repeat the state transition", async () => {
    const subscription = repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "TRIAL" });
    const rawBody = webhookBody();
    const header = sign(rawBody, Math.floor(Date.now() / 1000));

    await service.handlePaddleWebhook(rawBody, header);
    const afterFirst = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(afterFirst!.version).toBe(subscription.version + 1);

    // Exact same body + a freshly-signed (but same event_id) header — simulates Paddle's own retry.
    const secondHeader = sign(rawBody, Math.floor(Date.now() / 1000));
    await service.handlePaddleWebhook(rawBody, secondHeader);

    const afterSecond = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(afterSecond!.version).toBe(afterFirst!.version); // NOT incremented again
    expect(afterSecond!.state).toBe("ACTIVE");
  });

  it("transaction.completed is never authoritative on its own — no state change, safely acknowledged", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "TRIAL" });
    const rawBody = webhookBody({ event_type: "transaction.completed" });
    const header = sign(rawBody, Math.floor(Date.now() / 1000));

    await service.handlePaddleWebhook(rawBody, header);

    const subscription = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(subscription!.state).toBe("TRIAL"); // unchanged — never grants ACTIVE by itself
  });

  it("subscription.past_due transitions to PAYMENT_FAILED, which blocks operational entitlements", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "ACTIVE" });
    const rawBody = webhookBody({ event_type: "subscription.past_due" });
    const header = sign(rawBody, Math.floor(Date.now() / 1000));

    await service.handlePaddleWebhook(rawBody, header);

    const subscription = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(subscription!.state).toBe("PAYMENT_FAILED");
    const entitlements = await repo.listCurrentEntitlementsForWorkspace(WORKSPACE_A);
    expect(entitlements.find((e) => e.capability === "REPORT_EXPORT")!.state).toBe("BLOCKED");
  });

  it("subscription.updated with scheduled_change.action=cancel -> CANCELLED_AT_PERIOD_END keeps full operations (does not stop service early)", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "ACTIVE" });
    const rawBody = webhookBody({
      event_type: "subscription.updated",
      data: { id: "sub_1", customer_id: "ctm_1", status: "active", scheduled_change: { action: "cancel" }, custom_data: { workspaceId: WORKSPACE_A } },
    });
    const header = sign(rawBody, Math.floor(Date.now() / 1000));

    await service.handlePaddleWebhook(rawBody, header);

    const subscription = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(subscription!.state).toBe("CANCELLED_AT_PERIOD_END");
    expect(subscription!.cancelAtPeriodEnd).toBe(true);
    const entitlements = await repo.listCurrentEntitlementsForWorkspace(WORKSPACE_A);
    expect(entitlements.every((e) => e.state === "ALLOWED")).toBe(true); // full operations, matches Active
  });

  it("no custom_data.workspaceId -> safe no-op (never guesses/looks up cross-tenant)", async () => {
    const rawBody = JSON.stringify({ event_id: `evt_${randomUUID()}`, event_type: "subscription.activated", data: { id: "sub_x" } });
    const header = sign(rawBody, Math.floor(Date.now() / 1000));
    await expect(service.handlePaddleWebhook(rawBody, header)).resolves.toBeUndefined();
  });

  it("a stale/replayed timestamp is rejected even with a correctly-computed HMAC", async () => {
    repo.seedSubscription({ workspaceId: WORKSPACE_A, state: "TRIAL" });
    const rawBody = webhookBody();
    const staleHeader = sign(rawBody, Math.floor(Date.now() / 1000) - 3600);

    await expect(service.handlePaddleWebhook(rawBody, staleHeader)).rejects.toBeInstanceOf(UnauthenticatedException);
    const subscription = await repo.findSubscriptionByWorkspaceId(WORKSPACE_A);
    expect(subscription!.state).toBe("TRIAL");
  });
});
