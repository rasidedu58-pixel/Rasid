import { Inject, Injectable } from "@nestjs/common";
import type {
  Enrollment,
  EnrollmentCreateRequest,
  EnrollmentCreateResponse,
  EnrollmentPreviewRequest,
  EnrollmentPreviewResponse,
  EnrollmentTransferPreviewRequest,
  EnrollmentTransferPreviewResponse,
  EnrollmentTransferRequest,
  EnrollmentTransferResponse,
  EnrollmentWithdrawRequest,
  EnrollmentWithdrawResponse,
  FeeMethod,
  Obligation,
} from "@academic-precision/contracts";
import { PRORATION_UNAVAILABLE, computeObligationDueDate, computeProration } from "@academic-precision/database";
import type { EnrollmentRow, FinancialObligationRow, GroupMonthRow, GroupRow, ObligationTerms } from "@academic-precision/database";
import {
  EnrollmentNotEligibleException,
  ResourceNotFoundException,
  ValidationApiException,
} from "../../common/exceptions/api.exception";
import type { VerifiedSupabaseToken } from "../../identity/infrastructure/jwt-token-verifier";
import type { WorkspaceContext } from "../../team/api/guards/permission.guard";
import { PermissionResolverService } from "../../team/application/permission-resolver.service";
import { PreviewTokenService } from "../../scheduling/application/preview-token.service";
import { STUDENTS_REPOSITORY, type StudentsRepositoryPort } from "./ports/students-repository.port";

const ENROLLMENT_PREVIEW_KIND = "EnrollmentCreate";
const TRANSFER_PREVIEW_KIND = "EnrollmentTransfer";
const UNAVAILABLE_MESSAGE = "لا توجد حصص قابلة للحساب هذا الشهر؛ اختر مبلغًا كاملاً أو مخصصًا.";

interface EnrollmentPreviewPayload {
  groupMonthId: string;
  studentId: string;
  joinDate: string;
  feeMethod: FeeMethod;
  customFeeMinor: number | null;
  calculatedDueMinor: number;
}

interface TransferPreviewPayload {
  sourceEnrollmentId: string;
  targetGroupMonthId: string;
  joinDate: string;
  feeMethod: FeeMethod;
  calculatedDueMinor: number;
}

/**
 * Application service for Phase 4 Enrollment endpoints. Unlike
 * `StudentsService`, Enrollment IS naturally group-anchored (via
 * `group_month_id` → `group_id`), so every operation here performs an
 * `isGroupInScope` check exactly like `SchedulingService` does for
 * sessions — see the phase brief's own callout and `StudentsService`'s
 * doc comment for the contrasting Student/Guardian/QR reasoning.
 *
 * Phase 6: `createEnrollment`/`transfer` now persist the enrollment AND its
 * `financial_obligations` row in ONE transaction ("Enrollment + obligation
 * transaction" — API Contract §9.5's own description; previously deferred,
 * Phase 4 pre-authorized scoping decision #1, closed now). Obligation
 * `due_date` resolution uses `groupMonth.dueDay ?? workspace.unifiedDueDay`
 * — Database Schema §4.2/§5.4 marks the full UNIFIED/PER_GROUP/OVERRIDE
 * branching itself "وفق Product mapping النهائي" (still pending), so this
 * picks the more-specific value when set rather than inventing that
 * branch — see `computeObligationDueDate`'s own doc comment.
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    @Inject(STUDENTS_REPOSITORY) private readonly repository: StudentsRepositoryPort,
    private readonly permissionResolver: PermissionResolverService,
    private readonly previewTokens: PreviewTokenService,
  ) {}

  async previewEnrollment(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupMonthId: string,
    body: EnrollmentPreviewRequest,
  ): Promise<EnrollmentPreviewResponse> {
    const { groupMonth } = await this.loadGroupMonthInScope(authUser, workspaceContext, groupMonthId, "students.edit");
    await this.loadStudentInWorkspace(workspaceContext, body.studentId);

    const feeMethod = this.resolveFeeMethod(groupMonth, body.feeMethod);
    const { calculatedDueMinor, eligibleSessions, totalBillableSessions, rounding } =
      await this.computeDue(workspaceContext, groupMonth, feeMethod, body.joinDate, body.customFeeMinor);

    const payload: EnrollmentPreviewPayload = {
      groupMonthId,
      studentId: body.studentId,
      joinDate: body.joinDate,
      feeMethod,
      customFeeMinor: feeMethod === "CUSTOM" ? (body.customFeeMinor ?? null) : null,
      calculatedDueMinor,
    };
    const { token, expiresAt } = this.previewTokens.issue<EnrollmentPreviewPayload>(
      ENROLLMENT_PREVIEW_KIND,
      workspaceContext.workspaceId,
      payload,
    );

    return {
      baseFeeMinor: groupMonth.baseFeeMinor,
      eligibleSessions,
      totalBillableSessions,
      calculatedDueMinor,
      currency: groupMonth.currencyCode,
      formula: feeMethod,
      rounding,
      previewToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async createEnrollment(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupMonthId: string,
    body: EnrollmentCreateRequest,
    correlationId: string | null,
  ): Promise<EnrollmentCreateResponse> {
    const { groupMonth } = await this.loadGroupMonthInScope(authUser, workspaceContext, groupMonthId, "students.edit");
    const student = await this.loadStudentInWorkspace(workspaceContext, body.studentId);

    const plan = this.previewTokens.consume<EnrollmentPreviewPayload>(
      ENROLLMENT_PREVIEW_KIND,
      workspaceContext.workspaceId,
      body.previewToken,
    );
    if (
      plan.groupMonthId !== groupMonthId ||
      plan.studentId !== student.id ||
      plan.joinDate !== body.joinDate ||
      plan.feeMethod !== body.feeMethod
    ) {
      throw new ValidationApiException({ previewToken: ["رمز المعاينة لا يطابق بيانات هذا الطلب."] });
    }
    if (plan.feeMethod === "CUSTOM" && plan.customFeeMinor !== (body.customFeeMinor ?? null)) {
      throw new ValidationApiException({ customFeeMinor: ["يجب أن يطابق المبلغ المعاين."] });
    }

    // Re-validate join-date eligibility server-side even though the preview
    // already computed it — never trust the client-supplied payload as
    // authorization (API Contract §11.4).
    if (plan.feeMethod === "REMAINING_SESSIONS") {
      const recomputed = await this.computeDue(workspaceContext, groupMonth, plan.feeMethod, plan.joinDate, undefined);
      if (recomputed.calculatedDueMinor !== plan.calculatedDueMinor) {
        throw new EnrollmentNotEligibleException(
          "تغيرت بيانات الحصص منذ المعاينة. يرجى إعادة المعاينة.",
        );
      }
    }

    const obligationTerms = await this.resolveObligationTerms(workspaceContext, groupMonth, plan.feeMethod, plan.calculatedDueMinor, {
      joinDate: plan.joinDate,
      customFeeMinor: plan.feeMethod === "CUSTOM" ? plan.customFeeMinor : null,
    });

    // Documented Phase 4 status decision: ACTIVE at creation unconditionally
    // (no PENDING→ACTIVE background worker exists yet — see handoff
    // DEVIATIONS). join_date remains the authority for roster-visibility
    // logic, which is a Phase 5 (Session Mode) concern not exercised here.
    const { enrollment, reactivated, obligation } = await this.repository.createOrReactivateEnrollmentTransaction({
      workspaceId: workspaceContext.workspaceId,
      studentId: student.id,
      groupMonthId,
      joinDate: plan.joinDate,
      status: "ACTIVE",
      feeMethod: plan.feeMethod,
      customFeeMinor: plan.feeMethod === "CUSTOM" ? plan.customFeeMinor : null,
      obligation: obligationTerms,
    });

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: reactivated ? "enrollment.reactivated" : "enrollment.created",
      entityType: "enrollment",
      entityId: enrollment.id,
      afterJson: { enrollment: this.toEnrollmentDto(enrollment), obligation: this.toObligationDto(obligation) },
      correlationId,
    });

    return { enrollment: this.toEnrollmentDto(enrollment), obligation: this.toObligationDto(obligation) };
  }

  async withdrawEnrollment(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: EnrollmentWithdrawRequest,
    correlationId: string | null,
  ): Promise<EnrollmentWithdrawResponse> {
    const { enrollment: before } = await this.loadEnrollmentInScope(authUser, workspaceContext, id, "students.edit");

    const updated = await this.repository.withdrawEnrollment({
      id,
      reason: body.reason ?? null,
      effectiveDate: body.effectiveDate ? new Date(`${body.effectiveDate}T00:00:00Z`) : undefined,
    });
    if (!updated) {
      throw new EnrollmentNotEligibleException("هذا التسجيل منتهٍ بالفعل.");
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "enrollment.withdrawn",
      entityType: "enrollment",
      entityId: updated.id,
      beforeJson: this.toEnrollmentDto(before),
      afterJson: this.toEnrollmentDto(updated),
      reason: body.reason ?? null,
      correlationId,
    });

    // Read-only echo — withdrawal never mutates the obligation itself
    // ("old debt stays independent", same reasoning as Transfer's source).
    const obligation = await this.repository.findObligationByEnrollmentId(updated.id);
    return { enrollment: this.toEnrollmentDto(updated), obligation: obligation ? this.toObligationDto(obligation) : null };
  }

  async transferPreview(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: EnrollmentTransferPreviewRequest,
  ): Promise<EnrollmentTransferPreviewResponse> {
    const { enrollment: source } = await this.loadEnrollmentInScope(authUser, workspaceContext, id, "students.edit");
    const { groupMonth: target } = await this.loadGroupMonthInScope(
      authUser,
      workspaceContext,
      body.targetGroupMonthId,
      "students.edit",
    );

    const joinDate = body.joinDate ?? new Date().toISOString().slice(0, 10);

    // Product Decision — Transfer Fee Method: same Proration Engine as a
    // normal Enrollment preview. REMAINING_SESSIONS with zero billable
    // sessions is rejected by `computeDue` itself (UNAVAILABLE_MESSAGE) —
    // identical rule to regular Enrollment, not a bespoke one.
    const { calculatedDueMinor, eligibleSessions, totalBillableSessions, rounding } = await this.computeDue(
      workspaceContext,
      target,
      body.feeMethod,
      joinDate,
      undefined,
    );

    const payload: TransferPreviewPayload = {
      sourceEnrollmentId: source.id,
      targetGroupMonthId: target.id,
      joinDate,
      feeMethod: body.feeMethod,
      calculatedDueMinor,
    };
    const { token, expiresAt } = this.previewTokens.issue<TransferPreviewPayload>(
      TRANSFER_PREVIEW_KIND,
      workspaceContext.workspaceId,
      payload,
    );

    return {
      targetGroupMonthId: target.id,
      targetBaseFeeMinor: target.baseFeeMinor,
      targetCurrency: target.currencyCode,
      feeMethod: body.feeMethod,
      calculatedDueMinor,
      eligibleSessions,
      totalBillableSessions,
      rounding,
      previewToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async transfer(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    id: string,
    body: EnrollmentTransferRequest,
    correlationId: string | null,
  ): Promise<EnrollmentTransferResponse> {
    await this.loadEnrollmentInScope(authUser, workspaceContext, id, "students.edit");

    const plan = this.previewTokens.consume<TransferPreviewPayload>(
      TRANSFER_PREVIEW_KIND,
      workspaceContext.workspaceId,
      body.previewToken,
    );
    if (plan.sourceEnrollmentId !== id) {
      throw new ValidationApiException({ previewToken: ["رمز المعاينة لا يخص هذا التسجيل."] });
    }
    if (plan.feeMethod !== body.feeMethod) {
      throw new ValidationApiException({ feeMethod: ["يجب أن يطابق طريقة الرسوم المعاينة."] });
    }
    // Re-validate target scope server-side at transfer time too (not just
    // at preview time) — state can change between preview and apply.
    const { groupMonth: target } = await this.loadGroupMonthInScope(
      authUser,
      workspaceContext,
      plan.targetGroupMonthId,
      "students.edit",
    );

    // Re-validate REMAINING_SESSIONS eligibility server-side even though the
    // preview already computed it — never trust the client-supplied payload
    // as authorization (API Contract §11.4), same rule as a normal
    // Enrollment create.
    if (plan.feeMethod === "REMAINING_SESSIONS") {
      const recomputed = await this.computeDue(workspaceContext, target, plan.feeMethod, plan.joinDate, undefined);
      if (recomputed.calculatedDueMinor !== plan.calculatedDueMinor) {
        throw new EnrollmentNotEligibleException("تغيرت بيانات الحصص منذ المعاينة. يرجى إعادة المعاينة.");
      }
    }

    const obligationTerms = await this.resolveObligationTerms(workspaceContext, target, plan.feeMethod, plan.calculatedDueMinor, {
      joinDate: plan.joinDate,
      transferredFromEnrollmentId: plan.sourceEnrollmentId,
    });

    const result = await this.repository.transferEnrollmentTransaction({
      sourceEnrollmentId: plan.sourceEnrollmentId,
      targetGroupMonthId: plan.targetGroupMonthId,
      targetWorkspaceId: workspaceContext.workspaceId,
      joinDate: plan.joinDate,
      status: "ACTIVE",
      // Product Decision — Transfer Fee Method: explicit, caller-chosen at
      // preview time, re-validated here — no silent backend default.
      feeMethod: plan.feeMethod,
      customFeeMinor: null,
      obligation: obligationTerms,
    });
    if (!result) {
      throw new ResourceNotFoundException();
    }

    await this.repository.insertAuditEvent({
      workspaceId: workspaceContext.workspaceId,
      actorUserId: authUser.id,
      actorMembershipId: workspaceContext.membership.id,
      action: "enrollment.transferred",
      entityType: "enrollment",
      entityId: result.source.id,
      afterJson: {
        source: this.toEnrollmentDto(result.source),
        target: this.toEnrollmentDto(result.target),
        obligation: this.toObligationDto(result.obligation),
      },
      correlationId,
    });

    return {
      source: this.toEnrollmentDto(result.source),
      target: this.toEnrollmentDto(result.target),
      obligation: this.toObligationDto(result.obligation),
    };
  }

  // ---------------------------------------------------------------------
  // Fee/proration helpers
  // ---------------------------------------------------------------------

  /**
   * Maps GroupMonth's `join_fee_policy` (ASK_EVERY_TIME/FULL/REMAINING —
   * Phase 3 schema) to Enrollment's `fee_method`
   * (FULL_MONTH/CUSTOM/REMAINING_SESSIONS — Phase 4 schema):
   *   FULL            -> FULL_MONTH (forced; body.feeMethod ignored)
   *   REMAINING       -> REMAINING_SESSIONS (forced; body.feeMethod ignored)
   *   ASK_EVERY_TIME   -> body.feeMethod is REQUIRED (any of the three)
   */
  private resolveFeeMethod(groupMonth: GroupMonthRow, requested: FeeMethod | undefined): FeeMethod {
    if (groupMonth.joinFeePolicy === "FULL") return "FULL_MONTH";
    if (groupMonth.joinFeePolicy === "REMAINING") return "REMAINING_SESSIONS";
    if (!requested) {
      throw new ValidationApiException({
        feeMethod: ["مطلوب عند سياسة رسوم الانضمام (اسأل في كل مرة)."],
      });
    }
    return requested;
  }

  private async computeDue(
    workspaceContext: WorkspaceContext,
    groupMonth: GroupMonthRow,
    feeMethod: FeeMethod,
    joinDate: string,
    customFeeMinor: number | undefined,
  ): Promise<{
    calculatedDueMinor: number;
    eligibleSessions: number | null;
    totalBillableSessions: number | null;
    rounding: string | null;
  }> {
    if (feeMethod === "FULL_MONTH") {
      return { calculatedDueMinor: groupMonth.baseFeeMinor, eligibleSessions: null, totalBillableSessions: null, rounding: null };
    }

    if (feeMethod === "CUSTOM") {
      if (customFeeMinor === undefined) {
        throw new ValidationApiException({ customFeeMinor: ["مطلوب عند اختيار مبلغ مخصص."] });
      }
      return { calculatedDueMinor: customFeeMinor, eligibleSessions: null, totalBillableSessions: null, rounding: null };
    }

    // REMAINING_SESSIONS
    const workspaceTimezone = await this.repository.findWorkspaceTimezone(workspaceContext.workspaceId);
    if (!workspaceTimezone) {
      throw new ValidationApiException({ _root: ["تعذر تحديد المنطقة الزمنية لمساحة العمل."] });
    }
    const sessions = await this.repository.listSessionsForGroupMonth(groupMonth.id);
    const result = computeProration({
      baseFeeMinor: groupMonth.baseFeeMinor,
      joinDate,
      workspaceTimezone,
      sessions: sessions.map((s) => ({
        scheduledAt: s.scheduledAt,
        status: s.status as "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "RESCHEDULED",
        billableForProration: s.billableForProration,
      })),
    });
    if (result === PRORATION_UNAVAILABLE) {
      throw new ValidationApiException({ feeMethod: [UNAVAILABLE_MESSAGE] });
    }
    return {
      calculatedDueMinor: result.calculatedDueMinor,
      eligibleSessions: result.eligibleSessions,
      totalBillableSessions: result.totalBillableSessions,
      rounding: result.rounding,
    };
  }

  // ---------------------------------------------------------------------
  // Obligation helpers (Phase 6)
  // ---------------------------------------------------------------------

  /**
   * Builds the `financial_obligations` terms for a join/transfer:
   * `baseFeeMinor` is the Enrollment's OWN already-resolved charge
   * (`calculatedDueMinor` — whatever `computeDue`'s FULL_MONTH/CUSTOM/
   * REMAINING_SESSIONS formula produced), NOT the GroupMonth's raw policy
   * fee. `due_date` resolves `groupMonth.dueDay ?? workspace.unifiedDueDay`
   * — see the class doc comment for why the fuller UNIFIED/PER_GROUP/
   * OVERRIDE branching itself is intentionally NOT implemented here.
   */
  private async resolveObligationTerms(
    workspaceContext: WorkspaceContext,
    groupMonth: GroupMonthRow,
    feeMethod: FeeMethod,
    calculatedDueMinor: number,
    snapshotExtra: Record<string, unknown>,
  ): Promise<ObligationTerms> {
    const workspace = await this.repository.findWorkspaceById(workspaceContext.workspaceId);
    if (!workspace) {
      throw new ValidationApiException({ _root: ["تعذر تحديد مساحة العمل."] });
    }
    const operatingMonth = await this.repository.findOperatingMonthById(groupMonth.operatingMonthId);
    if (!operatingMonth) {
      throw new ValidationApiException({ _root: ["تعذر تحديد الشهر التشغيلي لهذه المجموعة."] });
    }
    const workspaceTimezone = await this.repository.findWorkspaceTimezone(workspaceContext.workspaceId);
    if (!workspaceTimezone) {
      throw new ValidationApiException({ _root: ["تعذر تحديد المنطقة الزمنية لمساحة العمل."] });
    }
    const dueDay = groupMonth.dueDay ?? workspace.unifiedDueDay;
    if (dueDay === null || dueDay === undefined) {
      throw new ValidationApiException({ _root: ["تعذر تحديد يوم استحقاق الرسوم لهذا الشهر."] });
    }
    const dueDate = computeObligationDueDate({
      year: operatingMonth.year,
      month: operatingMonth.month,
      dueDay,
      workspaceTimezone,
    });

    return {
      baseFeeMinor: calculatedDueMinor,
      currencyCode: groupMonth.currencyCode,
      dueDate,
      calculationBasis: feeMethod,
      calculationSnapshotJson: { groupMonthBaseFeeMinor: groupMonth.baseFeeMinor, feeMethod, ...snapshotExtra },
    };
  }

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

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------

  private async loadGroupMonthInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    groupMonthId: string,
    permission: "students.edit",
  ): Promise<{ groupMonth: GroupMonthRow; group: GroupRow }> {
    const groupMonth = await this.repository.findGroupMonthById(groupMonthId);
    if (!groupMonth || groupMonth.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    const group = await this.repository.findGroupById(groupMonth.groupId);
    if (!group) throw new ResourceNotFoundException();

    const inScope = await this.permissionResolver.isGroupInScope(
      workspaceContext.workspaceId,
      authUser.id,
      permission,
      group.id,
    );
    if (!inScope) throw new ResourceNotFoundException();

    return { groupMonth, group };
  }

  private async loadEnrollmentInScope(
    authUser: VerifiedSupabaseToken,
    workspaceContext: WorkspaceContext,
    enrollmentId: string,
    permission: "students.edit",
  ): Promise<{ enrollment: EnrollmentRow }> {
    const enrollment = await this.repository.findEnrollmentById(enrollmentId);
    if (!enrollment || enrollment.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    await this.loadGroupMonthInScope(authUser, workspaceContext, enrollment.groupMonthId, permission);
    return { enrollment };
  }

  private async loadStudentInWorkspace(workspaceContext: WorkspaceContext, studentId: string) {
    const student = await this.repository.findStudentById(studentId);
    if (!student || student.workspaceId !== workspaceContext.workspaceId) {
      throw new ResourceNotFoundException();
    }
    return student;
  }

  // ---------------------------------------------------------------------
  // DTO mapper
  // ---------------------------------------------------------------------

  private toEnrollmentDto(row: EnrollmentRow): Enrollment {
    return {
      id: row.id,
      studentId: row.studentId,
      groupMonthId: row.groupMonthId,
      joinDate: row.joinDate,
      status: row.status as Enrollment["status"],
      feeMethod: row.feeMethod as Enrollment["feeMethod"],
      customFeeMinor: row.customFeeMinor,
      version: row.version,
    };
  }
}
