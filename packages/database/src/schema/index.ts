/**
 * Schema barrel. `identity`, `workspaces` are implemented as of Phase 1.
 * `permissions` (memberships, permission_grants, permission_group_scopes)
 * and `audit` (audit_events) are implemented as of Phase 2. `months`
 * (locations, operating_months), `groups` (groups, group_months,
 * schedule_rules), `sessions`, and `idempotency` (idempotency_records) are
 * implemented as of Phase 3. `students`, `guardians` (guardians +
 * student_guardians), `qrCredentials`, and `enrollments` are implemented as
 * of Phase 4. `sessionExams` and `sessionRecords` are implemented as of
 * Phase 5 — see each module's own comment. All other modules remain
 * structural placeholders reserved for later phases.
 */
export * as identity from "./identity";
export * as workspaces from "./workspaces";
export * as permissions from "./permissions";
export * as months from "./months";
export * as groups from "./groups";
export * as students from "./students";
export * as guardians from "./guardians";
export * as qrCredentials from "./qr-credentials";
export * as enrollments from "./enrollments";
export * as sessions from "./sessions";
export * as sessionExams from "./session-exams";
export * as sessionRecords from "./session-records";
export * as finance from "./finance";
export * as attention from "./attention";
export * as followup from "./followup";
export * as subscriptions from "./subscriptions";
export * as notifications from "./notifications";
export * as audit from "./audit";
export * as outbox from "./outbox";
export * as idempotency from "./idempotency";
