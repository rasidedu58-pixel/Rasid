/**
 * Platform Issues Center — worker/queue health derived from `outbox_events`.
 * Read-only, cross-tenant, on the `app_platform_admin` connection. Requires the
 * 0057 SELECT grant; without it every query raises "permission denied" and we
 * degrade to `available:false` / UNKNOWN (never a 500). No persistence, no
 * incident system — the picture is recomputed from the live queue each call.
 */
import { inArray, sql } from "drizzle-orm";
import { getPlatformAdminDb } from "../connection";
import { outboxEvents } from "../schema/outbox";
import { WORKER_CONSUMED_EVENT_TYPES } from "../worker/outbox-dispatcher";

const STALE_MINUTES = 10; // an unprocessed event older than this ⇒ the worker is behind
const RECENT_PROCESS_HOURS = 2; // evidence the worker is actively draining the queue

export type WorkerStatus = "OPERATIONAL" | "DEGRADED" | "DOWN" | "UNKNOWN";

export interface WorkerHealthSnapshot {
  available: boolean;
  status: WorkerStatus;
  jobs: { pending: number; retrying: number; dead: number };
  deadCount: number;
  staleBacklogCount: number;
  oldestUnprocessedAt: Date | null;
  recentProblems: Array<{ at: Date; part: string; attemptCount: number; resolved: boolean }>;
}

const unavailable: WorkerHealthSnapshot = {
  available: false,
  status: "UNKNOWN",
  jobs: { pending: 0, retrying: 0, dead: 0 },
  deadCount: 0,
  staleBacklogCount: 0,
  oldestUnprocessedAt: null,
  recentProblems: [],
};

export async function getWorkerHealthSnapshot(): Promise<WorkerHealthSnapshot> {
  const db = getPlatformAdminDb();
  try {
    // Worker health is only meaningful for the event types the worker actually
    // consumes (WORKER_CONSUMED_EVENT_TYPES). An unconsumed type (e.g.
    // MonthCreated) sits PENDING forever by design and must not read as backlog.
    const consumed = inArray(outboxEvents.eventType, [...WORKER_CONSUMED_EVENT_TYPES]);
    const [counts] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${outboxEvents.status} = 'PENDING')`.mapWith(Number),
        processing: sql<number>`count(*) filter (where ${outboxEvents.status} = 'PROCESSING')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${outboxEvents.status} = 'FAILED')`.mapWith(Number),
        dead: sql<number>`count(*) filter (where ${outboxEvents.status} = 'DEAD')`.mapWith(Number),
        lastProcessed: sql<Date | null>`max(${outboxEvents.processedAt})`,
        oldestUnprocessed: sql<Date | null>`min(${outboxEvents.availableAt}) filter (where ${outboxEvents.status} in ('PENDING','PROCESSING') and ${outboxEvents.availableAt} <= now())`,
        staleBacklog: sql<number>`count(*) filter (where ${outboxEvents.status} in ('PENDING','PROCESSING') and ${outboxEvents.availableAt} < now() - interval '${sql.raw(String(STALE_MINUTES))} minutes')`.mapWith(Number),
      })
      .from(outboxEvents)
      .where(consumed);

    const pending = counts?.pending ?? 0;
    const processing = counts?.processing ?? 0;
    const failed = counts?.failed ?? 0;
    const dead = counts?.dead ?? 0;
    const staleBacklog = counts?.staleBacklog ?? 0;
    const lastProcessed = counts?.lastProcessed ? new Date(counts.lastProcessed) : null;
    const oldestUnprocessed = counts?.oldestUnprocessed ? new Date(counts.oldestUnprocessed) : null;

    // Deterministic worker status.
    let status: WorkerStatus;
    const recentlyProcessed = lastProcessed ? lastProcessed.getTime() > Date.now() - RECENT_PROCESS_HOURS * 3600_000 : false;
    if (dead > 0 || staleBacklog > 0) {
      status = "DEGRADED";
    } else if (recentlyProcessed || pending + processing + failed === 0) {
      status = "OPERATIONAL";
    } else {
      // There is unprocessed work but no evidence of recent draining — can't
      // positively confirm the worker is running, and it isn't clearly broken.
      status = "UNKNOWN";
    }

    const problemRows = await db
      .select({
        at: sql<Date>`coalesce(${outboxEvents.processedAt}, ${outboxEvents.availableAt}, ${outboxEvents.occurredAt})`,
        part: outboxEvents.eventType,
        attemptCount: outboxEvents.attemptCount,
        status: outboxEvents.status,
      })
      .from(outboxEvents)
      .where(sql`${consumed} and ${outboxEvents.attemptCount} > 0 and ${outboxEvents.status} in ('DEAD','FAILED','PROCESSED')`)
      .orderBy(sql`coalesce(${outboxEvents.processedAt}, ${outboxEvents.availableAt}, ${outboxEvents.occurredAt}) desc`)
      .limit(15);

    return {
      available: true,
      status,
      jobs: { pending, retrying: failed + processing, dead },
      deadCount: dead,
      staleBacklogCount: staleBacklog,
      oldestUnprocessedAt: oldestUnprocessed,
      recentProblems: problemRows.map((r) => ({
        at: new Date(r.at),
        part: r.part,
        attemptCount: r.attemptCount,
        resolved: r.status === "PROCESSED",
      })),
    };
  } catch {
    // 0057 grant not applied yet, or RLS blocked — degrade, never 500.
    return unavailable;
  }
}
