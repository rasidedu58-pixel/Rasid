import { PaymentRequestsService } from "./payment-requests.service";
import { ForbiddenApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";

/**
 * Owner-only enforcement (Billing Phase 3 + 4). `assertOwner` runs BEFORE any DB
 * access on every customer plan-change endpoint, so a non-owner member is
 * refused synchronously — no DB, no upgrade quote, no scheduled downgrade. Team
 * members and any non-OWNER role are denied here; SUPPORT_AGENT / platform
 * commercial mutation is covered by the platform RBAC contract tests.
 */
const user = { id: "user-1" } as VerifiedSupabaseToken;
const nonOwnerContext = { workspaceId: "ws-1", membership: { roleLabel: "ASSISTANT" } } as unknown as WorkspaceContext;

describe("PaymentRequestsService — owner-only plan changes", () => {
  const service = new PaymentRequestsService();

  it("rejects a non-owner from every customer billing mutation/read, before any DB call", async () => {
    await expect(service.getPlanState(user, nonOwnerContext)).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.quoteUpgrade(user, nonOwnerContext, { targetPlanCode: "ADVANCED", billingCycle: "MONTHLY" })).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.scheduleDowngrade(user, nonOwnerContext, { targetPlanCode: "STARTER" })).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.cancelDowngrade(user, nonOwnerContext)).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.createPaymentRequest(user, nonOwnerContext, { planCode: "PROFESSIONAL", billingCycle: "MONTHLY", paymentMethod: "INSTAPAY" })).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.listPaymentRequests(user, nonOwnerContext)).rejects.toBeInstanceOf(ForbiddenApiException);
  });
});
