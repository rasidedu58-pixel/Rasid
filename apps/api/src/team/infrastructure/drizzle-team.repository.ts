import { Injectable } from "@nestjs/common";
import {
  createMembershipForTesting,
  disableMembership,
  findActiveOrAnyMembership,
  findMembershipById,
  getDb,
  insertAuditEvent,
  listActiveGrantsForMembership,
  listMembershipsForWorkspace,
  replaceMembershipGrants,
  type AuditEventInput,
  type AuditEventRow,
  type DesiredGrantInput,
  type GrantWithScopes,
  type MembershipRow,
} from "@academic-precision/database";
import type { TeamRepositoryPort } from "../application/ports/team-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link TeamRepositoryPort}.
 * Thin adapter only — all persistence/transaction logic lives in
 * packages/database, mirroring `DrizzleIdentityRepository` (Phase 1).
 */
@Injectable()
export class DrizzleTeamRepository implements TeamRepositoryPort {
  findMembershipById(membershipId: string): Promise<MembershipRow | undefined> {
    return findMembershipById(getDb(), membershipId);
  }

  findMembershipByUserAndWorkspace(userId: string, workspaceId: string): Promise<MembershipRow | undefined> {
    return findActiveOrAnyMembership(getDb(), workspaceId, userId);
  }

  listMembershipsForWorkspace(workspaceId: string): Promise<MembershipRow[]> {
    return listMembershipsForWorkspace(getDb(), workspaceId);
  }

  listActiveGrants(membershipId: string): Promise<GrantWithScopes[]> {
    return listActiveGrantsForMembership(getDb(), membershipId);
  }

  replaceMembershipGrants(params: {
    workspaceId: string;
    membershipId: string;
    createdByUserId: string;
    desiredGrants: DesiredGrantInput[];
  }): Promise<{ before: GrantWithScopes[]; after: GrantWithScopes[] }> {
    return replaceMembershipGrants(getDb(), params);
  }

  disableMembership(membershipId: string): Promise<MembershipRow> {
    return disableMembership(getDb(), membershipId);
  }

  insertAuditEvent(input: AuditEventInput): Promise<AuditEventRow> {
    return insertAuditEvent(getDb(), input);
  }

  createMembershipForTesting(input: {
    workspaceId: string;
    userId: string;
    roleLabel: string;
    status?: "INVITED" | "ACTIVE" | "DISABLED";
  }): Promise<MembershipRow> {
    return createMembershipForTesting(getDb(), input);
  }
}
