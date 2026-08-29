import { createHash } from "node:crypto";
import type {
  AcceptInvitationResult,
  CreateInvitationInput,
  InvitationPreview,
  InvitationRow,
} from "@academic-precision/database";
import {
  AlreadyMemberException,
  InvitationInvalidException,
  PermissionScopeInvalidException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../api/guards/permission.guard";
import { FakeGroupOwnershipPort } from "./__fixtures__/fake-group-ownership.port";
import { InMemoryTeamRepository } from "./__fixtures__/in-memory-team.repository";
import type { InvitationRepositoryPort } from "./ports/invitation-repository.port";
import { InvitationsService } from "./invitations.service";

const WORKSPACE_A = "workspace-a";
const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** In-memory double for {@link InvitationRepositoryPort} — no live Postgres. */
class InMemoryInvitationRepository implements InvitationRepositoryPort {
  readonly byId = new Map<string, InvitationRow>();
  /** Scripted accept result the service will receive (defaults to a fresh success). */
  acceptResult: AcceptInvitationResult = { ok: true, workspaceId: WORKSPACE_A, membershipId: "m-new", roleLabel: "MEMBER" };
  /** Captures the LAST tokenHash the service passed to accept/preview. */
  lastAcceptHash: string | null = null;
  lastPreviewHash: string | null = null;
  preview: InvitationPreview | null = null;
  private seq = 0;

  async createInvitation(input: CreateInvitationInput): Promise<InvitationRow> {
    const now = new Date();
    const row: InvitationRow = {
      id: `inv-${++this.seq}`,
      workspaceId: input.workspaceId,
      tokenHash: input.tokenHash,
      roleLabel: input.roleLabel,
      desiredGrants: input.desiredGrants,
      invitedLabel: input.invitedLabel,
      status: "PENDING",
      invitedByUserId: input.invitedByUserId,
      acceptedByUserId: null,
      acceptedMembershipId: null,
      expiresAt: input.expiresAt,
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    };
    this.byId.set(row.id, row);
    return row;
  }

  async listInvitations(workspaceId: string): Promise<InvitationRow[]> {
    return [...this.byId.values()].filter((r) => r.workspaceId === workspaceId);
  }

  async findInvitationById(invitationId: string): Promise<InvitationRow | undefined> {
    return this.byId.get(invitationId);
  }

  async revokeInvitation(invitationId: string): Promise<InvitationRow | undefined> {
    const row = this.byId.get(invitationId);
    if (!row || row.status !== "PENDING") return undefined;
    const updated: InvitationRow = { ...row, status: "REVOKED", revokedAt: new Date() };
    this.byId.set(invitationId, updated);
    return updated;
  }

  async previewInvitation(tokenHash: string): Promise<InvitationPreview | null> {
    this.lastPreviewHash = tokenHash;
    return this.preview;
  }

  async acceptInvitation(params: { tokenHash: string; accepterUserId: string }): Promise<AcceptInvitationResult> {
    this.lastAcceptHash = params.tokenHash;
    return this.acceptResult;
  }
}

describe("InvitationsService", () => {
  let repository: InMemoryInvitationRepository;
  let groupOwnership: FakeGroupOwnershipPort;
  let teamRepository: InMemoryTeamRepository;
  let service: InvitationsService;
  let owner: VerifiedSupabaseToken;
  let ownerContext: WorkspaceContext;

  beforeEach(() => {
    repository = new InMemoryInvitationRepository();
    groupOwnership = new FakeGroupOwnershipPort();
    teamRepository = new InMemoryTeamRepository();
    service = new InvitationsService(repository, groupOwnership, teamRepository);
    owner = { id: "u-owner", email: "owner@example.com" };
    const ownerMembership = teamRepository.seedMembership({ workspaceId: WORKSPACE_A, userId: owner.id, roleLabel: "OWNER" });
    ownerContext = { workspaceId: WORKSPACE_A, membership: ownerMembership };
  });

  describe("createInvitation", () => {
    it("returns a raw token that is NEVER stored — only its SHA-256 hash is persisted", async () => {
      const res = await service.createInvitation(
        owner,
        ownerContext,
        { grants: [{ permission: "students.view_basic", scope: "ALL_GROUPS" }] },
        null,
      );

      const stored = repository.byId.get(res.id)!;
      expect(stored.tokenHash).toBe(sha256(res.token));
      expect(stored.tokenHash).not.toBe(res.token);
      expect(res.status).toBe("PENDING");
    });

    it("never writes the raw token or its hash into the audit trail", async () => {
      const res = await service.createInvitation(
        owner,
        ownerContext,
        { grants: [{ permission: "students.view_basic", scope: "ALL_GROUPS" }] },
        null,
      );

      const audit = teamRepository.auditEvents.find((e) => e.action === "invitation.created");
      expect(audit).toBeDefined();
      const serialized = JSON.stringify(audit?.afterJson ?? {});
      expect(serialized).not.toContain(res.token);
      expect(serialized).not.toContain(sha256(res.token));
    });

    it("rejects a team.manage grant (owner-only, never invitable)", async () => {
      await expect(
        service.createInvitation(owner, ownerContext, { grants: [{ permission: "team.manage", scope: "ALL_GROUPS" }] }, null),
      ).rejects.toBeInstanceOf(PermissionScopeInvalidException);
    });

    it("rejects a SELECTED_GROUPS grant whose group id is not in the workspace", async () => {
      const foreignGroup = "11111111-1111-1111-1111-111111111111";
      // Not registered with groupOwnership for WORKSPACE_A → treated as foreign.
      await expect(
        service.createInvitation(
          owner,
          ownerContext,
          { grants: [{ permission: "groups.view", scope: "SELECTED_GROUPS", groupIds: [foreignGroup] }] },
          null,
        ),
      ).rejects.toBeInstanceOf(PermissionScopeInvalidException);
    });

    it("stores a non-owner MEMBER role and the exact authorized grants", async () => {
      const res = await service.createInvitation(
        owner,
        ownerContext,
        { grants: [{ permission: "students.view_basic", scope: "ALL_GROUPS" }], invitedLabel: "أ. محمد" },
        null,
      );
      const stored = repository.byId.get(res.id)!;
      expect(stored.roleLabel).toBe("MEMBER");
      expect(stored.invitedLabel).toBe("أ. محمد");
      expect(stored.desiredGrants).toEqual([{ permissionKey: "students.view_basic", scopeType: "ALL_GROUPS", groupIds: undefined }]);
    });
  });

  describe("acceptInvitation", () => {
    it("hashes the raw token before it ever reaches the repository", async () => {
      await service.acceptInvitation({ id: "u-invitee" } as VerifiedSupabaseToken, "raw-token-xyz");
      expect(repository.lastAcceptHash).toBe(sha256("raw-token-xyz"));
    });

    it("maps a successful accept to an ACTIVE membership response", async () => {
      const res = await service.acceptInvitation({ id: "u-invitee" } as VerifiedSupabaseToken, "raw-token");
      expect(res).toEqual({ workspaceId: WORKSPACE_A, membershipId: "m-new", status: "ACTIVE" });
    });

    it("fails closed with INVITATION_INVALID for an invalid/expired/used token", async () => {
      repository.acceptResult = { ok: false, reason: "INVALID" };
      await expect(service.acceptInvitation({ id: "u-invitee" } as VerifiedSupabaseToken, "raw")).rejects.toBeInstanceOf(
        InvitationInvalidException,
      );
    });

    it("reports ALREADY_MEMBER distinctly", async () => {
      repository.acceptResult = { ok: false, reason: "ALREADY_MEMBER" };
      await expect(service.acceptInvitation({ id: "u-invitee" } as VerifiedSupabaseToken, "raw")).rejects.toBeInstanceOf(
        AlreadyMemberException,
      );
    });
  });

  describe("previewInvitation", () => {
    it("maps stored grants to permission keys for display", async () => {
      repository.preview = {
        status: "PENDING",
        valid: true,
        roleLabel: "MEMBER",
        workspaceId: "11111111-1111-1111-1111-111111111111",
        workspaceName: "مركز النور",
        expiresAt: new Date().toISOString(),
        desiredGrants: [
          { permissionKey: "students.view_basic", scopeType: "ALL_GROUPS" },
          { permissionKey: "groups.view", scopeType: "SELECTED_GROUPS", groupIds: ["g1"] },
        ],
      };
      const res = await service.previewInvitation({ id: "u-invitee" } as VerifiedSupabaseToken, "raw");
      expect(res.workspaceId).toBe("11111111-1111-1111-1111-111111111111");
      expect(res.workspaceName).toBe("مركز النور");
      expect(res.valid).toBe(true);
      expect(res.permissions).toEqual(["students.view_basic", "groups.view"]);
    });

    it("fails closed when the token resolves to nothing", async () => {
      repository.preview = null;
      await expect(service.previewInvitation({ id: "u-invitee" } as VerifiedSupabaseToken, "raw")).rejects.toBeInstanceOf(
        InvitationInvalidException,
      );
    });
  });
});
