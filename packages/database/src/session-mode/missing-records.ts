/**
 * Pure "missing session records" derivation — Phase 5's own single source
 * of truth, EXTRACTED (not reimplemented) in the Phase 9 Closure correction
 * so `reports`/`action-center` can reuse the EXACT SAME rule Phase 5's
 * `SessionModeService.computeReview` already uses for `GET
 * /sessions/{id}/review` and `POST /sessions/{id}/complete`, rather than
 * inventing a second, divergent definition (the correction explicitly
 * rejects "session scheduled time passed + not COMPLETED" as a stand-in for
 * "has missing records" — those are different concepts).
 *
 * Missing = `attendance_status`/`homework_status` is `NULL` on the
 * SessionRecord for an eligible enrollment (Database Schema §7.3). Exam is
 * deliberately never part of this — it is entirely OPTIONAL and never
 * contributes to "missing" (mirrors the exact comment in
 * `session-mode.service.ts`'s `computeReview`).
 */

export interface MissingRecordsRecordInput {
  attendanceStatus: string | null;
  homeworkStatus: string | null;
}

export interface MissingRecordEntry {
  enrollmentId: string;
  studentName: string;
  missing: ("ATTENDANCE" | "HOMEWORK")[];
}

export interface AttendanceTally {
  present: number;
  absent: number;
  late: number;
  missing: number;
}

export interface HomeworkTally {
  done: number;
  partial: number;
  notDone: number;
  noHomework: number;
  missing: number;
}

export interface DeriveMissingRecordsResult {
  missingRecords: MissingRecordEntry[];
  attendanceSummary: AttendanceTally;
  homeworkSummary: HomeworkTally;
}

export function deriveMissingRecords(params: {
  eligibleEnrollmentIds: string[];
  recordsByEnrollmentId: Map<string, MissingRecordsRecordInput>;
  studentNameByEnrollmentId: Map<string, string>;
}): DeriveMissingRecordsResult {
  const attendanceSummary: AttendanceTally = { present: 0, absent: 0, late: 0, missing: 0 };
  const homeworkSummary: HomeworkTally = { done: 0, partial: 0, notDone: 0, noHomework: 0, missing: 0 };
  const missingRecords: MissingRecordEntry[] = [];

  for (const enrollmentId of params.eligibleEnrollmentIds) {
    const record = params.recordsByEnrollmentId.get(enrollmentId);
    const missing: ("ATTENDANCE" | "HOMEWORK")[] = [];

    switch (record?.attendanceStatus) {
      case "PRESENT":
        attendanceSummary.present += 1;
        break;
      case "ABSENT":
        attendanceSummary.absent += 1;
        break;
      case "LATE":
        attendanceSummary.late += 1;
        break;
      default:
        attendanceSummary.missing += 1;
        missing.push("ATTENDANCE");
    }

    switch (record?.homeworkStatus) {
      case "DONE":
        homeworkSummary.done += 1;
        break;
      case "PARTIAL":
        homeworkSummary.partial += 1;
        break;
      case "NOT_DONE":
        homeworkSummary.notDone += 1;
        break;
      case "NO_HOMEWORK":
        homeworkSummary.noHomework += 1;
        break;
      default:
        homeworkSummary.missing += 1;
        missing.push("HOMEWORK");
    }

    if (missing.length > 0) {
      missingRecords.push({
        enrollmentId,
        studentName: params.studentNameByEnrollmentId.get(enrollmentId) ?? "",
        missing,
      });
    }
  }

  return { missingRecords, attendanceSummary, homeworkSummary };
}
