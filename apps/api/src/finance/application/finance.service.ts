import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  CollectionQueueResponse,
  FinanceSummaryResponse,
  Obligation,
  Payment,
  PaymentMethod,
  RecordPaymentRequest,
  RecordPaymentResponse,
  ReversePaymentRequest,
  ReversePaymentResponse,
  StudentObligationsResponse,
} from "@academic-precision/contracts";
import {
  OBLIGATION_NOT_FOUND,
  OBLIGATION_NOT_PAYABLE,
  PAYMENT_ALREADY_REVERSED,
  PAYMENT_EXCEEDS_REMAINING,
  PAYMENT_NOT_FOUND,
  type CollectionQueueRow,
  type FinancialObligationRow,
  type MembershipRow,
  type PaymentRow,
} from "@academic-precision/database";
import {
  ForbiddenApiException,
  IdempotencyConflictException,
  ObligationNotPayableException,
  PaymentAlreadyReversedException,
  PaymentExceedsRemainingException,
  ResourceNotFoundException,
  ValidationApiException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { FINANCE_REPOSITORY, type FinanceRepositoryPort } from "./ports/finance-repository.port";

const RECORD_PAYMENT_OPERATION = "RecordPayment";
const REVERSE_PAYMENT_OPERATION = "ReversePayment";
const COLLECTION_QUEUE_LIMIT = 200;

/**
 * Application service for Phase 6 Finance endpoints (Record Payment /
 * Reverse Payment / Student Obligations / Collection Queue / Finance
 * Summary). Controllers stay thin; all authorization/business rules live
 * here, mirroring the Phase 1-5 convention.
 *
 * `recordPaymentTransaction`/`reversePaymentTransaction` (packages/database)
 * already do the lock+validate+mutate+AUDIT+OUTBOX inside ONE DB
 * transaction (Database Schema §17.1 steps 3-8 — audit is explicitly named
 * part of the atomic scope here, unlike Session Mode's CompleteSession,
 * where it wasn't) — this service only orchestrates the Idempotency-Key
 * lifecycle around that transaction (steps 2/9), matching the established
 * CreateMonth/CompleteSession pattern.
 *
 * `payments.record` NEVER implies `finance.overview` (API Contract §10's
 * own explicit rule) — enforced structurally: `recordPayment`/
 * `reversePayment` only ever check `payments.record`+Group Scope,
 * `getFinanceSummary` only ever checks `finance.overview`+its own scope;
 * neither code path can satisfy the other.
 */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(FINANCE_REPOSITORY) private readonly repository: FinanceRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
  ) {}

  // ---------------------------------------------------------------------
  // Record Payment
  // ---------------------------------------------------------------------

  async recordPayment(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    idempotencyKey: string | null,
    body: RecordPaymentRequest,
    correlationId: string | null,
  ): Promise<RecordPaymentResponse> {
    if (!idempotencyKey) {
      throw new ValidationApiException({ "Idempotency-Key": ["مطلوب لتسجيل دفعة."] });
    }
    await this.assertObligationInScope(authUser, workspaceContext, body.obligationId, "payments.record");

    const requestHash = createHash("sha256")
      .update(JSON.stringify({ obligationId: body.obligationId, amountMinor: body.amountMinor, method: body.method, note: body.note ?? null }))
      .digest("hex");
    const existingRecord = await this.repository.findIdempotencyRecord(workspaceContext.workspaceId, RECORD_PAYMENT_OPERATION, idempotencyKey);
    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) throw new IdempotencyConflictException();
      if (existingRecord.status === "COMPLETED" && existingRecord.responsePayload) {
        return existingRecord.responsePayload as RecordPaymentResponse;
      }
    }

    const idempotencyRow =
      existingRecord ??
      (await this.repository.tryInsertIdempotencyRecord({
        workspaceId: workspaceContext.workspaceId,
        operation: RECORD_PAYMENT_OPERATION,
        key: idempotencyKey,
        requestHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })) ??
      (await this.repository.findIdempotencyRecord(workspaceContext.workspaceId, RECORD_PAYMENT_OPERATION, idempotencyKey));
    if (!idempotencyRow) {
      throw new ValidationApiException({ _root: ["تعذر تسجيل مفتاح idempotency."] });
    }
    if (idempotencyRow.requestHash !== requestHash) throw new IdempotencyConflictException();
    if (idempotencyRow.status === "COMPLETED" && idempotencyRow.responsePayload) {
      return idempotencyRow.responsePayload as RecordPaymentResponse;
    }

    const result = await this.repository.recordPaymentTransaction({
      workspaceId: workspaceContext.workspaceId,
      obligationId: body.obligationId,
      amountMinor: body.amountMinor,
      method: body.method as PaymentMethod,
      paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      note: body.note ?? null,
      idempotencyKey,
      recordedByUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      correlationId,
    });

    if (result === OBLIGATION_NOT_FOUND) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new ResourceNotFoundException();
    }
    if (result === OBLIGATION_NOT_PAYABLE) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new ObligationNotPayableException();
    }
    if (result === PAYMENT_EXCEEDS_REMAINING) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      const obligation = await this.repository.findObligationById(body.obligationId);
      throw new PaymentExceedsRemainingException(undefined, { remainingMinor: obligation?.remainingMinor });
    }

    const response: RecordPaymentResponse = {
      payment: this.toPaymentDto(result.payment),
      obligation: this.toObligationDto(result.obligation),
    };
    await this.repository.completeIdempotencyRecord(idempotencyRow.id, 200, response);
    return response;
  }

  // ---------------------------------------------------------------------
  // Reverse Payment
  // ---------------------------------------------------------------------

  async reversePayment(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    idempotencyKey: string | null,
    body: ReversePaymentRequest,
    correlationId: string | null,
  ): Promise<ReversePaymentResponse> {
    if (!idempotencyKey) {
      throw new ValidationApiException({ "Idempotency-Key": ["مطلوب لعكس دفعة."] });
    }
    const payment = await this.repository.findPaymentById(id);
    if (!payment || payment.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    await this.assertObligationInScope(authUser, workspaceContext, payment.obligationId, "payments.record");

    const requestHash = createHash("sha256").update(JSON.stringify({ paymentId: id, reason: body.reason })).digest("hex");
    const existingRecord = await this.repository.findIdempotencyRecord(workspaceContext.workspaceId, REVERSE_PAYMENT_OPERATION, idempotencyKey);
    if (existingRecord) {
      if (existingRecord.requestHash !== requestHash) throw new IdempotencyConflictException();
      if (existingRecord.status === "COMPLETED" && existingRecord.responsePayload) {
        return existingRecord.responsePayload as ReversePaymentResponse;
      }
    }

    const idempotencyRow =
      existingRecord ??
      (await this.repository.tryInsertIdempotencyRecord({
        workspaceId: workspaceContext.workspaceId,
        operation: REVERSE_PAYMENT_OPERATION,
        key: idempotencyKey,
        requestHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })) ??
      (await this.repository.findIdempotencyRecord(workspaceContext.workspaceId, REVERSE_PAYMENT_OPERATION, idempotencyKey));
    if (!idempotencyRow) {
      throw new ValidationApiException({ _root: ["تعذر تسجيل مفتاح idempotency."] });
    }
    if (idempotencyRow.requestHash !== requestHash) throw new IdempotencyConflictException();
    if (idempotencyRow.status === "COMPLETED" && idempotencyRow.responsePayload) {
      return idempotencyRow.responsePayload as ReversePaymentResponse;
    }

    const result = await this.repository.reversePaymentTransaction({
      workspaceId: workspaceContext.workspaceId,
      paymentId: id,
      reason: body.reason,
      reversedByUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      correlationId,
    });

    if (result === PAYMENT_NOT_FOUND) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new ResourceNotFoundException();
    }
    if (result === PAYMENT_ALREADY_REVERSED) {
      await this.repository.failIdempotencyRecord(idempotencyRow.id);
      throw new PaymentAlreadyReversedException();
    }

    const response: ReversePaymentResponse = {
      payment: this.toPaymentDto(result.payment),
      reversal: { id: result.reversal.id, reason: result.reversal.reason },
      obligation: this.toObligationDto(result.obligation),
    };
    await this.repository.completeIdempotencyRecord(idempotencyRow.id, 200, response);
    return response;
  }

  // ---------------------------------------------------------------------
  // Student obligations
  // ---------------------------------------------------------------------

  async getStudentObligations(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    studentId: string,
  ): Promise<StudentObligationsResponse> {
    const student = await this.repository.findStudentById(studentId);
    if (!student || student.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }

    const restrictToGroupIds = await this.resolveGroupScopeFilter(workspaceContext.workspaceId, authUser.id, "payments.view_student_status");
    const rows = await this.repository.listObligationsForStudent({ workspaceId: workspaceContext.workspaceId, studentId });
    const visible = restrictToGroupIds === undefined ? rows : rows.filter((r) => restrictToGroupIds.includes(r.groupId));

    return {
      obligations: visible.map((r) => ({ obligation: this.toObligationDto(r.obligation), groupMonthId: r.groupMonthId })),
    };
  }

  // ---------------------------------------------------------------------
  // Collection Queue — permission is "payments.view_student_status OR
  // finance.overview" (API Contract §9.6's own "or" wording); NestJS
  // @RequirePermission only expresses a single required key, so the base
  // PermissionGuard is left with no decorator on this route (still
  // requires an active membership) and the actual OR-permission check
  // happens here.
  // ---------------------------------------------------------------------

  async getCollectionQueue(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    query: { cursor?: string } = {},
  ): Promise<CollectionQueueResponse> {
    // Phase 15C — this OR-permission route carries no @RequirePermission, so
    // the guard resolved no single grant to reuse; but it DID fetch (and
    // require ACTIVE) the caller's membership from the SAME team repository
    // the resolver uses. Handing that row in lets the resolver skip
    // re-querying it while resolving both permissions. Scope/union semantics
    // are unchanged (a mismatched/stale hint is ignored by the resolver).
    const restrictToGroupIds = await this.resolveEitherPermissionScope(
      workspaceContext.workspaceId,
      authUser.id,
      ["payments.view_student_status", "finance.overview"],
      workspaceContext.membership,
    );
    if (restrictToGroupIds === "FORBIDDEN") {
      throw new ForbiddenApiException();
    }

    // Phase 15 fix — cursor pagination replacing the silent LIMIT-200
    // truncation (see the repository's comment). Opaque "<dueDate>_<id>".
    let cursor: { dueDate: string; id: string } | undefined;
    if (query.cursor) {
      const sep = query.cursor.indexOf("_");
      if (sep > 0) {
        const dueDate = query.cursor.slice(0, sep);
        const id = query.cursor.slice(sep + 1);
        if (dueDate && id) cursor = { dueDate, id };
      }
    }

    const rows = await this.repository.listCollectionQueue({
      workspaceId: workspaceContext.workspaceId,
      restrictToGroupIds,
      limit: COLLECTION_QUEUE_LIMIT + 1,
      cursor,
    });

    const hasNext = rows.length > COLLECTION_QUEUE_LIMIT;
    const items = rows.slice(0, COLLECTION_QUEUE_LIMIT);
    const last = items[items.length - 1];

    return {
      items: items.map((r) => this.toCollectionQueueItemDto(r)),
      page: {
        hasNext,
        nextCursor: hasNext && last ? `${last.obligation.dueDate}_${last.obligation.id}` : null,
      },
    };
  }

  // ---------------------------------------------------------------------
  // Finance summary — finance.overview ONLY (payments.record never implies it).
  // ---------------------------------------------------------------------

  async getFinanceSummary(authUser: VerifiedSupabaseToken, workspaceContext: WorkspaceContext): Promise<FinanceSummaryResponse> {
    // Phase 15C — reuse the "finance.overview" grant PermissionGuard already
    // resolved for this route (@RequirePermission("finance.overview")), from
    // the SAME team repository the resolver uses. `payments.record` STILL
    // cannot reach here: the guard only ever stashes THIS route's own
    // required-permission grant, and the `=== "finance.overview"` check
    // refuses anything else, falling back to a real finance.overview
    // resolution. So the "record never implies overview" invariant is intact.
    const grant =
      workspaceContext.grant?.permission === "finance.overview"
        ? workspaceContext.grant
        : await this.permissionResolver.hasPermission(workspaceContext.workspaceId, authUser.id, "finance.overview");
    if (!grant) {
      throw new ForbiddenApiException();
    }
    const restrictToGroupIds = grant.scope === "ALL_GROUPS" ? undefined : (grant.groupIds ?? []);

    const todayIsoDate = new Date().toISOString().slice(0, 10);
    const summary = await this.repository.getFinanceSummary({
      workspaceId: workspaceContext.workspaceId,
      restrictToGroupIds,
      todayIsoDate,
    });

    return { currency: "EGP", ...summary };
  }

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------

  private async assertObligationInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    obligationId: string,
    permission: "payments.record",
  ): Promise<void> {
    const obligation = await this.repository.findObligationById(obligationId);
    if (!obligation || obligation.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    const context = await this.repository.findObligationGroupContext(obligationId);
    if (!context) {
      throw new ResourceNotFoundException();
    }
    const inScope = await this.permissionResolver.isGroupInScope(workspaceContext.workspaceId, authUser.id, permission, context.groupId);
    if (!inScope) {
      throw new ResourceNotFoundException();
    }
  }

  private async resolveGroupScopeFilter(
    workspaceId: string,
    authUserId: string,
    permission: "payments.view_student_status" | "finance.overview",
  ): Promise<string[] | undefined> {
    const grant = await this.permissionResolver.hasPermission(workspaceId, authUserId, permission);
    if (!grant) return []; // no grant — matches nothing
    if (grant.scope === "ALL_GROUPS") return undefined;
    return grant.groupIds ?? [];
  }

  /** Union of scopes across MULTIPLE permissions (any one satisfies access) — for the Collection Queue's "or" gate. Returns `"FORBIDDEN"` if NEITHER permission is granted. */
  private async resolveEitherPermissionScope(
    workspaceId: string,
    authUserId: string,
    permissions: readonly ("payments.view_student_status" | "finance.overview")[],
    knownActiveMembership?: MembershipRow,
  ): Promise<string[] | undefined | "FORBIDDEN"> {
    const grants = await Promise.all(
      permissions.map((p) => this.permissionResolver.hasPermission(workspaceId, authUserId, p, knownActiveMembership)),
    );
    const granted = grants.filter((g): g is NonNullable<typeof g> => !!g);
    if (granted.length === 0) return "FORBIDDEN";
    if (granted.some((g) => g.scope === "ALL_GROUPS")) return undefined;
    const union = new Set<string>();
    for (const g of granted) for (const id of g.groupIds ?? []) union.add(id);
    return [...union];
  }

  // ---------------------------------------------------------------------
  // DTO mappers
  // ---------------------------------------------------------------------

  private toObligationDto(row: FinancialObligationRow): Obligation {
    return {
      id: row.id,
      enrollmentId: row.enrollmentId,
      currency: row.currencyCode,
      baseFeeMinor: row.baseFeeMinor,
      discountMinor: row.discountMinor,
      waiverMinor: row.waiverMinor,
      netDueMinor: row.netDueMinor,
      dueDate: row.dueDate,
      amountPaidMinor: row.amountPaidMinor,
      remainingMinor: row.remainingMinor,
      status: row.status as Obligation["status"],
      calculationBasis: row.calculationBasis as Obligation["calculationBasis"],
      version: row.version,
    };
  }

  private toPaymentDto(row: PaymentRow): Payment {
    return {
      id: row.id,
      obligationId: row.obligationId,
      amountMinor: row.amountMinor,
      currency: row.currencyCode,
      method: row.method as Payment["method"],
      paidAt: row.paidAt.toISOString(),
      status: row.status as Payment["status"],
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toCollectionQueueItemDto(row: CollectionQueueRow) {
    return {
      obligationId: row.obligation.id,
      studentId: row.studentId,
      studentName: row.studentName,
      studentCode: row.studentCode,
      groupMonthId: row.groupMonthId,
      dueDate: row.obligation.dueDate,
      netDueMinor: row.obligation.netDueMinor,
      amountPaidMinor: row.obligation.amountPaidMinor,
      remainingMinor: row.obligation.remainingMinor,
      status: row.obligation.status as Obligation["status"],
    };
  }
}
