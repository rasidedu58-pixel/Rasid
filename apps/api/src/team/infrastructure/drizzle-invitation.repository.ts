import { Injectable } from "@nestjs/common";
import {
  acceptInvitationTx,
  createInvitation,
  findInvitationById,
  listInvitations,
  previewInvitationTx,
  revokeInvitation,
  withRuntimeContext,
  type AcceptInvitationResult,
  type CreateInvitationInput,
  type InvitationPreview,
  type InvitationRow,
} from "@academic-precision/database";
import { getContext } from "@academic-precision/observability";
import type { InvitationRepositoryPort } from "../application/ports/invitation-repository.port";

/**
 * Real (PostgreSQL/Drizzle) implementation of {@link InvitationRepositoryPort}.
 *
 * Management calls (create/list/revoke) reach these methods only AFTER
 * `PermissionGuard` has authorized the caller for `team.manage`, so ambient
 * `RequestContextInterceptor` context is active and carries the resolved
 * `workspaceId`. The invitee-facing calls (preview/accept) run on
 * `SupabaseAuthGuard`-only routes with NO workspace context — they open a
 * `withRuntimeContext({ userId })` transaction and let the token-GUC RLS
 * policy admit the one matching invitation row.
 */
@Injectable()
export class DrizzleInvitationRepository implements InvitationRepositoryPort {
  /** `input.workspaceId` is the guard-verified workspace — prefer it over ambient context. */
  createInvitation(input: CreateInvitationInput): Promise<InvitationRow> {
    const ctx = getContext();
    return withRuntimeContext({ userId: ctx?.userId, workspaceId: input.workspaceId }, (db) =>
      createInvitation(db, input),
    );
  }

  listInvitations(workspaceId: string): Promise<InvitationRow[]> {
    const ctx = getContext();
    return withRuntimeContext({ userId: ctx?.userId, workspaceId }, (db) => listInvitations(db, workspaceId));
  }

  findInvitationById(invitationId: string): Promise<InvitationRow | undefined> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: ctx?.workspaceId as string | undefined },
      (db) => findInvitationById(db, invitationId),
    );
  }

  revokeInvitation(invitationId: string): Promise<InvitationRow | undefined> {
    const ctx = getContext();
    return withRuntimeContext(
      { userId: ctx?.userId, workspaceId: ctx?.workspaceId as string | undefined },
      (db) => revokeInvitation(db, invitationId),
    );
  }

  /**
   * User-scoped, workspace-less: the invitee is authenticated but not yet a
   * member. The single transaction sets `app.user_id`, then the repository
   * helper sets the transaction-scoped `app.invite_token_hash` GUC so the
   * token-read RLS policy admits exactly the matching row.
   */
  previewInvitation(tokenHash: string, accepterUserId: string): Promise<InvitationPreview | null> {
    return withRuntimeContext({ userId: accepterUserId }, (db) => previewInvitationTx(db, tokenHash));
  }

  /** The ENTIRE accept runs inside this one `withRuntimeContext` transaction. */
  acceptInvitation(params: { tokenHash: string; accepterUserId: string }): Promise<AcceptInvitationResult> {
    return withRuntimeContext({ userId: params.accepterUserId }, (db) => acceptInvitationTx(db, params));
  }
}
