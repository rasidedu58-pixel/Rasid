import { CustomPlansService } from "./custom-plans.service";
import { ForbiddenApiException } from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";

/**
 * Owner-only enforcement for Custom Plans (Phase 5). `assertOwner` runs BEFORE
 * any DB access, so a non-owner member (team, assistant) is refused synchronously
 * on every custom endpoint — no request, no offer accept, no payment.
 */
const user = { id: "user-1" } as VerifiedSupabaseToken;
const nonOwner = { workspaceId: "ws-1", membership: { roleLabel: "ASSISTANT" } } as unknown as WorkspaceContext;

describe("CustomPlansService — owner-only", () => {
  const service = new CustomPlansService();

  it("rejects a non-owner from every custom endpoint before any DB call", async () => {
    await expect(service.getState(user, nonOwner)).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.createRequest(user, nonOwner, { requestedMaxActiveStudents: 4000, requestedMaxTeamMembers: 20, preferredBillingCycle: "MONTHLY" })).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.cancelRequest(user, nonOwner)).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.acceptOffer(user, nonOwner, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.rejectOffer(user, nonOwner, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(ForbiddenApiException);
    await expect(service.createPayment(user, nonOwner, { acceptedOfferId: "00000000-0000-0000-0000-000000000000", paymentMethod: "INSTAPAY" })).rejects.toBeInstanceOf(ForbiddenApiException);
  });
});
