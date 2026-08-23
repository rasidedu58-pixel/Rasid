import { Injectable } from "@nestjs/common";
import { loadServerEnv } from "@academic-precision/config";
import type {
  BillingProviderPort,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  CreatePortalSessionInput,
  CreatePortalSessionResult,
} from "../application/ports/billing-provider.port";

const PADDLE_API_BASE_SANDBOX = "https://sandbox-api.paddle.com";
const PADDLE_API_BASE_LIVE = "https://api.paddle.com";

/**
 * Real Paddle implementation of {@link BillingProviderPort} — the ONLY
 * concrete provider behind ADR-014's `BillingProvider` adapter in V1.
 *
 * IMPORTANT, explicitly documented limitation: this repo has no live
 * Paddle sandbox/production credentials configured in this environment,
 * so this class's actual HTTP calls to Paddle's REST API have NOT been
 * exercised against a real Paddle account — only against
 * `FakeBillingProvider` in tests. The request/response shapes below
 * follow Paddle's own published Transactions API documentation (creating
 * a Transaction with `checkout.url` enabled is Paddle's documented
 * server-side mechanism for generating a shareable hosted-checkout link,
 * and the Customer Portal Sessions API is the documented mechanism for a
 * billing-management link) — this is the best-faith implementation
 * possible without live verification, not a shortcut; see the Phase 8
 * Completion Report for the explicit call-out.
 *
 * Uses Node's built-in `fetch` — no Paddle SDK dependency exists in this
 * monorepo.
 */
@Injectable()
export class PaddleBillingProvider implements BillingProviderPort {
  private apiBase(): string {
    const { PADDLE_ENVIRONMENT } = loadServerEnv();
    return PADDLE_ENVIRONMENT === "production" ? PADDLE_API_BASE_LIVE : PADDLE_API_BASE_SANDBOX;
  }

  private apiKey(): string {
    const { PADDLE_API_KEY } = loadServerEnv();
    if (!PADDLE_API_KEY) {
      throw new Error("PADDLE_API_KEY is not set. Configure it before creating a Paddle checkout/portal session.");
    }
    return PADDLE_API_KEY;
  }

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult> {
    const { PADDLE_PRICE_ID } = loadServerEnv();
    if (!PADDLE_PRICE_ID) {
      throw new Error("PADDLE_PRICE_ID is not set. Configure the V1 subscription price id before creating checkout sessions.");
    }

    const response = await fetch(`${this.apiBase()}/transactions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ price_id: PADDLE_PRICE_ID, quantity: 1 }],
        customer: input.customerEmail ? { email: input.customerEmail } : undefined,
        // custom_data is echoed back verbatim on every subsequent webhook
        // for this subscription — this is how the webhook processor
        // resolves workspace_id WITHOUT a prior DB lookup (see
        // billing.service.ts).
        custom_data: { workspaceId: input.workspaceId },
        checkout: { url: input.returnUrl },
      }),
    });

    if (!response.ok) {
      throw new Error(`Paddle checkout creation failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { data?: { checkout?: { url?: string } } };
    const checkoutUrl = body.data?.checkout?.url;
    if (!checkoutUrl) {
      throw new Error("Paddle checkout creation succeeded but returned no checkout.url.");
    }
    return { checkoutUrl };
  }

  async createPortalSession(input: CreatePortalSessionInput): Promise<CreatePortalSessionResult> {
    const response = await fetch(`${this.apiBase()}/customers/${input.providerCustomerId}/portal-sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      throw new Error(`Paddle portal session creation failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { data?: { urls?: { general?: { overview?: string } } } };
    const portalUrl = body.data?.urls?.general?.overview;
    if (!portalUrl) {
      throw new Error("Paddle portal session creation succeeded but returned no portal URL.");
    }
    return { portalUrl };
  }
}
