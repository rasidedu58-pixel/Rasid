/**
 * Platform Staff accept must ensure ONLY the application `users` row and must
 * NOT trigger tenant provisioning (workspace / owner membership / trial). This
 * unit test mocks the database layer and asserts the service calls
 * `ensureApplicationUser` (minimal user row) and NOT `createUserWorkspaceMembership`
 * (full provisioning), with identity taken from the verified JWT.
 */
jest.mock("@academic-precision/database", () => ({
  ensureApplicationUser: jest.fn(async () => undefined),
  acceptStaffInvitationTx: jest.fn(async () => ({ ok: true, role: "OPERATIONS_ADMIN" })),
  // Full-provisioning entry point — must never be reached on the staff path.
  createUserWorkspaceMembership: jest.fn(),
  provisionSubscriptionForNewWorkspaceTransaction: jest.fn(),
  // Other named exports the service imports (unused in this test).
  changePlatformStaffRole: jest.fn(),
  createStaffInvitation: jest.fn(),
  findStaffInvitationById: jest.fn(),
  listPlatformStaffMembers: jest.fn(),
  listStaffInvitations: jest.fn(),
  previewStaffInvitation: jest.fn(),
  revokeStaffInvitation: jest.fn(),
  setPlatformStaffStatus: jest.fn(),
}));

import {
  acceptStaffInvitationTx,
  createUserWorkspaceMembership,
  ensureApplicationUser,
  provisionSubscriptionForNewWorkspaceTransaction,
} from "@academic-precision/database";
import { PlatformStaffService } from "./platform-staff.service";

describe("PlatformStaffService.acceptInvitation — no tenant provisioning", () => {
  const service = new PlatformStaffService();

  beforeEach(() => jest.clearAllMocks());

  it("ensures only the application user row, then accepts — never full provisioning", async () => {
    const res = await service.acceptInvitation({ id: "user-1", email: "aya@rasid.test" }, "raw-token");

    // Minimal user row ensured, identity from the JWT (name derived, not client-supplied).
    expect(ensureApplicationUser).toHaveBeenCalledTimes(1);
    expect(ensureApplicationUser).toHaveBeenCalledWith({ authUserId: "user-1", email: "aya@rasid.test", fullName: "aya" });

    // Tenant provisioning is NEVER invoked on the staff path.
    expect(createUserWorkspaceMembership).not.toHaveBeenCalled();
    expect(provisionSubscriptionForNewWorkspaceTransaction).not.toHaveBeenCalled();

    // The accept itself ran and mapped to the response.
    expect(acceptStaffInvitationTx).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ role: "OPERATIONS_ADMIN", status: "ACTIVE" });
  });

  it("ensures the user row BEFORE inserting the platform_admins row (FK order)", async () => {
    const order: string[] = [];
    (ensureApplicationUser as jest.Mock).mockImplementationOnce(async () => {
      order.push("ensureUser");
    });
    (acceptStaffInvitationTx as jest.Mock).mockImplementationOnce(async () => {
      order.push("accept");
      return { ok: true, role: "SUPPORT_AGENT" };
    });

    await service.acceptInvitation({ id: "user-2", email: "b@c.test" }, "raw");
    expect(order).toEqual(["ensureUser", "accept"]);
  });

  it("falls back to a neutral display name when the JWT has no email", async () => {
    await service.acceptInvitation({ id: "user-3", email: null }, "raw");
    expect(ensureApplicationUser).toHaveBeenCalledWith({ authUserId: "user-3", email: null, fullName: "عضو فريق راصد" });
  });
});
