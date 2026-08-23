import { randomUUID } from "node:crypto";
import type {
  BillingProviderPort,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionResult,
  CreatePortalSessionInput,
  CreatePortalSessionResult,
} from "../ports/billing-provider.port";

/** Never calls a real network endpoint — records every call for assertions (e.g. "checkout creation never writes Subscription/Entitlement state" is proven at the SERVICE level, not by this fake, but tests can still assert this was called with the right custom_data-equivalent workspaceId). */
export class FakeBillingProvider implements BillingProviderPort {
  readonly checkoutCalls: CreateCheckoutSessionInput[] = [];
  readonly portalCalls: CreatePortalSessionInput[] = [];

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CreateCheckoutSessionResult> {
    this.checkoutCalls.push(input);
    return { checkoutUrl: `https://fake-paddle.test/checkout/${randomUUID()}` };
  }

  async createPortalSession(input: CreatePortalSessionInput): Promise<CreatePortalSessionResult> {
    this.portalCalls.push(input);
    return { portalUrl: `https://fake-paddle.test/portal/${randomUUID()}` };
  }
}
