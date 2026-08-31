import { Injectable } from "@nestjs/common";
import { getWorkerHealthSnapshot, pingDatabase } from "@academic-precision/database";
import {
  hasPlatformPermission,
  type PlatformIssue,
  type PlatformRecentProblem,
  type PlatformRole,
  type PlatformStatusResponse,
  type ServiceStatus,
} from "@academic-precision/contracts";

const STALE_MINUTES = 10;

/**
 * Platform Issues Center — server-known status. Derives DB readiness (live
 * ping) and worker health (from the outbox queue) into a status + derived,
 * non-persisted issue/problem list. `api`/`web` liveness is added client-side.
 * Job metrics + recent problems are redacted for callers without
 * platform.health.details (SUPPORT_AGENT gets the status + issue titles only).
 */
@Injectable()
export class PlatformStatusService {
  async getStatus(role: PlatformRole | null): Promise<PlatformStatusResponse> {
    const generatedAt = new Date().toISOString();

    let database: ServiceStatus = "OPERATIONAL";
    try {
      await pingDatabase();
    } catch {
      database = "DOWN";
    }

    const w = await getWorkerHealthSnapshot();
    const worker: ServiceStatus = w.status;

    const activeIssues: PlatformIssue[] = [];
    if (database === "DOWN") {
      activeIssues.push({
        id: "database-down",
        title: "قاعدة البيانات غير متاحة",
        affectedPart: "قاعدة البيانات",
        severity: "CRITICAL",
        status: "ACTIVE",
        startedAt: null,
        lastSeenAt: generatedAt,
        description: "تعذّر الاتصال بقاعدة البيانات (فحص الجاهزية فشل).",
        ctaHref: null,
      });
    }
    if (w.available && w.deadCount > 0) {
      activeIssues.push({
        id: "worker-dead-letters",
        title: "مهام خلفية فشلت نهائيًا",
        affectedPart: "المعالج الخلفي (Worker)",
        severity: w.deadCount >= 5 ? "CRITICAL" : "WARNING",
        status: "ACTIVE",
        startedAt: null,
        lastSeenAt: generatedAt,
        description: `${w.deadCount} حدثًا استنفد كل محاولات إعادة التشغيل ويحتاج تدخّلًا يدويًا.`,
        ctaHref: null,
      });
    }
    if (w.available && w.staleBacklogCount > 0) {
      activeIssues.push({
        id: "worker-backlog",
        title: "تأخّر في معالجة المهام الخلفية",
        affectedPart: "المعالج الخلفي (Worker)",
        severity: "WARNING",
        status: "ACTIVE",
        startedAt: w.oldestUnprocessedAt ? w.oldestUnprocessedAt.toISOString() : null,
        lastSeenAt: generatedAt,
        description: `${w.staleBacklogCount} مهمة معلّقة منذ أكثر من ${STALE_MINUTES} دقائق — قد يكون المعالج متوقفًا أو متأخرًا.`,
        ctaHref: null,
      });
    }

    const recentProblems: PlatformRecentProblem[] = w.recentProblems.map((p) => ({
      at: p.at.toISOString(),
      part: p.part,
      summary: `فشل بعد ${p.attemptCount} محاولة${p.resolved ? " (تمّ التعافي لاحقًا)" : ""}`,
      resolved: p.resolved,
    }));

    const canSeeDetails = hasPlatformPermission(role, "platform.health.details");
    return {
      database,
      worker,
      workerSource: w.available ? "available" : "unavailable",
      jobs: canSeeDetails && w.available ? w.jobs : null,
      activeIssues,
      recentProblems: canSeeDetails ? recentProblems : [],
      generatedAt,
    };
  }
}
