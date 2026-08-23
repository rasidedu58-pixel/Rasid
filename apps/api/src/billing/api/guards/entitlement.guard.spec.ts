import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import type { Capability, EntitlementState } from "@academic-precision/database";
import { EntitlementBlockedException, SubscriptionRequiredException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import { WORKSPACE_CONTEXT_REQUEST_KEY, type WorkspaceContext } from "../../../team/api/guards/permission.guard";
import type { EntitlementRepositoryPort } from "../../application/ports/entitlement-repository.port";
import { REQUIRED_ENTITLEMENT_METADATA_KEY } from "../decorators/require-entitlement.decorator";
import { EntitlementGuard } from "./entitlement.guard";

const WORKSPACE_A = "workspace-a";

class FakeEntitlementRepository implements EntitlementRepositoryPort {
  private readonly states = new Map<string, EntitlementState>();

  set(workspaceId: string, capability: Capability, state: EntitlementState): void {
    this.states.set(`${workspaceId}:${capability}`, state);
  }

  async findCurrentEntitlementState(workspaceId: string, capability: Capability): Promise<EntitlementState | undefined> {
    return this.states.get(`${workspaceId}:${capability}`);
  }
}

function makeContext(options: { workspaceContext?: WorkspaceContext; requiredCapability?: Capability }): ExecutionContext {
  const handler = () => undefined;
  if (options.requiredCapability) {
    Reflect.defineMetadata(REQUIRED_ENTITLEMENT_METADATA_KEY, options.requiredCapability, handler);
  }
  const request: Record<string, unknown> = {};
  if (options.workspaceContext) {
    request[WORKSPACE_CONTEXT_REQUEST_KEY] = options.workspaceContext;
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

function membership(): WorkspaceContext["membership"] {
  const now = new Date();
  return {
    id: "m-1",
    workspaceId: WORKSPACE_A,
    userId: "u-1",
    roleLabel: "ASSISTANT",
    status: "ACTIVE",
    joinedAt: now,
    disabledAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("EntitlementGuard", () => {
  let repository: FakeEntitlementRepository;
  let guard: EntitlementGuard;

  beforeEach(() => {
    repository = new FakeEntitlementRepository();
    guard = new EntitlementGuard(new Reflector(), repository);
  });

  it("passes through untouched when the route carries no @RequireEntitlement", async () => {
    const context = makeContext({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("allows the request when the capability is ALLOWED", async () => {
    repository.set(WORKSPACE_A, "CORE_OPERATIONS", "ALLOWED");
    const context = makeContext({
      workspaceContext: { workspaceId: WORKSPACE_A, membership: membership() },
      requiredCapability: "CORE_OPERATIONS",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("blocks with SUBSCRIPTION_REQUIRED when a non-REPORT_EXPORT capability is BLOCKED", async () => {
    repository.set(WORKSPACE_A, "CORE_OPERATIONS", "BLOCKED");
    const context = makeContext({
      workspaceContext: { workspaceId: WORKSPACE_A, membership: membership() },
      requiredCapability: "CORE_OPERATIONS",
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(SubscriptionRequiredException);
  });

  it("blocks with ENTITLEMENT_BLOCKED specifically for REPORT_EXPORT (CSV export gate)", async () => {
    repository.set(WORKSPACE_A, "REPORT_EXPORT", "BLOCKED");
    const context = makeContext({
      workspaceContext: { workspaceId: WORKSPACE_A, membership: membership() },
      requiredCapability: "REPORT_EXPORT",
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(EntitlementBlockedException);
  });

  it("fails CLOSED when no entitlement row exists at all (missing row is never a green light)", async () => {
    const context = makeContext({
      workspaceContext: { workspaceId: WORKSPACE_A, membership: membership() },
      requiredCapability: "TEAM_MANAGEMENT",
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(SubscriptionRequiredException);
  });

  it("throws UnauthenticatedException if PermissionGuard did not run first (no WorkspaceContext on request)", async () => {
    const context = makeContext({ requiredCapability: "CORE_OPERATIONS" });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthenticatedException);
  });

  it("Permission + Entitlement must BOTH independently succeed: entitlement ALLOWED does not imply permission granted (PermissionGuard is a separate, earlier guard in the chain — this guard alone never checks roleLabel)", async () => {
    // An ASSISTANT (non-Owner) with an ALLOWED entitlement still passes THIS
    // guard — proving EntitlementGuard genuinely does not fold Permission
    // logic into itself; PermissionGuard (run first, tested separately) is
    // what would have rejected an under-privileged caller.
    repository.set(WORKSPACE_A, "TEAM_MANAGEMENT", "ALLOWED");
    const context = makeContext({
      workspaceContext: { workspaceId: WORKSPACE_A, membership: membership() },
      requiredCapability: "TEAM_MANAGEMENT",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
