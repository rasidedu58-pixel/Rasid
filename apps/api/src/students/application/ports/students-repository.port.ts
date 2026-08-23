import type {
  CreateOrReactivateEnrollmentInput,
  EnrollmentRow,
  GroupMonthRow,
  GroupRow,
  GuardianRow,
  InsertGuardianInput,
  InsertStudentGuardianInput,
  InsertStudentInput,
  IssueQrInput,
  QrCredentialRow,
  ReissueQrInput,
  SessionRow,
  StudentGuardianRow,
  StudentGuardianWithGuardian,
  StudentRow,
  StudentsAuditEventInput,
  StudentSearchFilter,
  TransferEnrollmentTransactionInput,
  UpdateStudentGuardianInput,
  UpdateStudentInput,
  WithdrawEnrollmentInput,
} from "@academic-precision/database";

/**
 * Port (dependency-inversion boundary) between the students/guardians/QR/
 * enrollment application layer and its persistence — mirrors the Phase 1-3
 * `TeamRepositoryPort`/`SchedulingRepositoryPort` convention exactly.
 * `DrizzleStudentsRepository` is the real implementation; tests supply an
 * in-memory fake.
 *
 * Also carries the small set of GroupMonth/Group/Session READS enrollment
 * logic needs (join_fee_policy, base fee, currency, group scope anchor,
 * proration source sessions) rather than duplicating
 * `SchedulingRepositoryPort` — these delegate to the exact same
 * `packages/database` query helpers Phase 3 already uses.
 */
export interface StudentsRepositoryPort {
  findWorkspaceTimezone(workspaceId: string): Promise<string | undefined>;

  // GroupMonth/Group reads (enrollment scope + fee/schedule context)
  findGroupMonthById(id: string): Promise<GroupMonthRow | undefined>;
  findGroupById(id: string): Promise<GroupRow | undefined>;
  listSessionsForGroupMonth(groupMonthId: string): Promise<SessionRow[]>;

  // Students
  generateUniqueStudentCode(workspaceId: string): Promise<string>;
  findStudentById(id: string): Promise<StudentRow | undefined>;
  insertStudent(input: InsertStudentInput): Promise<StudentRow>;
  updateStudentWithVersion(
    id: string,
    expectedVersion: number,
    patch: UpdateStudentInput,
  ): Promise<StudentRow | undefined>;
  searchStudents(filter: StudentSearchFilter): Promise<StudentRow[]>;

  // Guardians / student_guardians
  insertGuardian(input: InsertGuardianInput): Promise<GuardianRow>;
  findGuardianById(id: string): Promise<GuardianRow | undefined>;
  insertStudentGuardian(input: InsertStudentGuardianInput): Promise<StudentGuardianRow>;
  findStudentGuardianById(id: string): Promise<StudentGuardianRow | undefined>;
  listGuardiansForStudent(studentId: string): Promise<StudentGuardianWithGuardian[]>;
  updateStudentGuardian(
    id: string,
    patch: UpdateStudentGuardianInput,
  ): Promise<StudentGuardianRow | undefined>;
  setPrimaryGuardianTransaction(
    studentId: string,
    guardianLinkId: string,
  ): Promise<StudentGuardianRow | undefined>;

  // QR
  findActiveQrForStudent(studentId: string): Promise<QrCredentialRow | undefined>;
  findQrByTokenHash(tokenHash: string): Promise<QrCredentialRow | undefined>;
  issueQrCredential(input: IssueQrInput): Promise<QrCredentialRow>;
  reissueQrCredentialTransaction(
    input: ReissueQrInput,
  ): Promise<{ revoked: QrCredentialRow | null; issued: QrCredentialRow }>;

  // Enrollments
  findEnrollmentById(id: string): Promise<EnrollmentRow | undefined>;
  findEnrollmentByStudentAndGroupMonth(
    studentId: string,
    groupMonthId: string,
  ): Promise<EnrollmentRow | undefined>;
  createOrReactivateEnrollmentTransaction(
    input: CreateOrReactivateEnrollmentInput,
  ): Promise<{ enrollment: EnrollmentRow; reactivated: boolean }>;
  withdrawEnrollment(input: WithdrawEnrollmentInput): Promise<EnrollmentRow | undefined>;
  transferEnrollmentTransaction(
    input: TransferEnrollmentTransactionInput,
  ): Promise<{ source: EnrollmentRow; target: EnrollmentRow; reactivated: boolean } | undefined>;

  // Audit
  insertAuditEvent(input: StudentsAuditEventInput): Promise<void>;
}

export const STUDENTS_REPOSITORY = Symbol("STUDENTS_REPOSITORY");
