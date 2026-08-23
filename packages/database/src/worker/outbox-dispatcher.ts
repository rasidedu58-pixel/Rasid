/**
 * Outbox dispatcher — Phase 7. Runs on the `app_worker` connection
 * (`getWorkerDb()`/`withWorkerRuntimeContext`, NEVER `app_runtime` or the
 * migration/admin role — see migrations/0032_app_worker_role.sql). Called
 * by `apps/worker`'s own sequential polling loop; also directly callable
 * from tests without a real worker process running.
 *
 * Claim/lease design (standard job-queue pattern, chosen because the
 * approved docs specify only the general Transactional Outbox shape,
 * ADR-018, not a concrete claim/lease recipe).
 *
 * Every timestamp comparison/write below uses the DATABASE's own `now()`
 * (via raw `sql`), never the caller process's local `Date.now()` — found
 * during live integration testing: comparing a column set via SQL `now()`
 * against a value computed from the calling machine's own clock is exactly
 * the kind of clock-skew bug that silently starves a worker running on a
 * host whose clock disagrees with the DB server's (a real risk for a
 * remote-region Postgres like Supabase's pooler) — the claim query would
 * then never see a row as "due" even though it manifestly is.
 *
 * 1. CLAIM (fast, own transaction): `SELECT ... FOR UPDATE SKIP LOCKED`
 *    one eligible row (`status IN ('PENDING','FAILED','PROCESSING')` AND
 *    `available_at <= now()` — PROCESSING is included so a row whose
 *    worker crashed mid-processing is eventually reclaimed once its lease
 *    expires), then `UPDATE ... SET status='PROCESSING',
 *    attempt_count=attempt_count+1, available_at=now()+LEASE` and commit.
 *    This transaction ALWAYS completes quickly and commits — it never
 *    holds the row lock while doing slow domain work.
 * 2. PROCESS (separate transaction): `SET LOCAL app.workspace_id` to the
 *    claimed event's own workspace, run the actual rule-engine evaluation,
 *    then mark the row PROCESSED — all in ONE transaction, so a crash here
 *    rolls back both the domain writes AND the PROCESSED flip together.
 *    If the worker process crashes between step 1 and step 2 committing,
 *    the row is left PROCESSING with a lease that expires after LEASE_MS —
 *    the next poll cycle (this process or another) reclaims it via step 1,
 *    and step 2 re-runs from scratch. Every domain write step 2 makes is
 *    idempotent by construction (Evidence's own UNIQUE constraint, Case/
 *    Reason upsert-by-unique-key), so a reclaim-and-retry never duplicates
 *    Cases/Evidence.
 * 3. On a genuine processing error (not a crash — a thrown exception
 *    caught in-process), a THIRD, separate transaction marks the row
 *    FAILED with an exponential-ish backoff `available_at`, so a
 *    persistently-broken event does not spin the poll loop.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { outboxEvents } from "../schema/outbox";
import { withWorkerRuntimeContext } from "../connection";
import type { Db } from "../repositories/identity.repository";
import { runEvaluateAttentionRulesForSessionTransaction } from "../repositories/attention.repository";

const LEASE_MS = 2 * 60 * 1000; // 2 minutes — generous for a single-session evaluation.
const MAX_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes cap.
const BASE_BACKOFF_MS = 30 * 1000; // 30 seconds per attempt.

export type OutboxEventRow = typeof outboxEvents.$inferSelect;

function backoffMs(attemptCount: number): number {
  return Math.min(attemptCount * BASE_BACKOFF_MS, MAX_BACKOFF_MS);
}

/** Step 1 — claim exactly one eligible event, or `undefined` if none is due. Runs on the caller-supplied `workerDb` (no workspace context needed — the worker doesn't know which workspace an event belongs to until it reads the row; see 0032's worker-only broad SELECT/UPDATE policy). */
async function claimOneEvent(workerDb: Db, eventTypes: string[]): Promise<OutboxEventRow | undefined> {
  return workerDb.transaction(async (tx) => {
    const [claimed] = await tx
      .select()
      .from(outboxEvents)
      .where(
        and(
          inArray(outboxEvents.status, ["PENDING", "FAILED", "PROCESSING"]),
          lte(outboxEvents.availableAt, sql`now()`),
          inArray(outboxEvents.eventType, eventTypes),
        ),
      )
      .orderBy(outboxEvents.availableAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!claimed) return undefined;

    const [updated] = await tx
      .update(outboxEvents)
      .set({
        status: "PROCESSING",
        attemptCount: claimed.attemptCount + 1,
        availableAt: sql`now() + (${LEASE_MS}::text || ' milliseconds')::interval`,
      })
      .where(eq(outboxEvents.id, claimed.id))
      .returning();
    return updated;
  });
}

/** Step 3 — mark a claimed event FAILED with a backoff delay, in its own small transaction (never inside the failed processing transaction itself, which just rolled back). */
async function markEventFailed(workerDb: Db, event: OutboxEventRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const delayMs = backoffMs(event.attemptCount);
  await workerDb
    .update(outboxEvents)
    .set({
      status: "FAILED",
      lastError: message.slice(0, 2000),
      availableAt: sql`now() + (${delayMs}::text || ' milliseconds')::interval`,
    })
    .where(eq(outboxEvents.id, event.id));
}

/** Step 2 — process one claimed event's domain effects + mark it PROCESSED, all in one transaction, with the correct workspace context set first. */
async function processClaimedEvent(workerDb: Db, event: OutboxEventRow): Promise<void> {
  if (!event.workspaceId) {
    // System-level events (no workspace) are not expected for any
    // consumer this dispatcher currently handles — nothing to do but
    // mark it processed so it doesn't spin forever.
    await workerDb.update(outboxEvents).set({ status: "PROCESSED", processedAt: sql`now()` }).where(eq(outboxEvents.id, event.id));
    return;
  }

  await withWorkerRuntimeContext({ workspaceId: event.workspaceId }, async (tx) => {
    if (event.eventType === "SessionCompleted") {
      const payload = event.payload as { sessionId?: string };
      if (payload.sessionId) {
        await runEvaluateAttentionRulesForSessionTransaction(tx, {
          workspaceId: event.workspaceId as string,
          sessionId: payload.sessionId,
        });
      }
    }
    await tx.update(outboxEvents).set({ status: "PROCESSED", processedAt: sql`now()` }).where(eq(outboxEvents.id, event.id));
  });
}

export interface ProcessPendingOutboxEventsResult {
  processed: number;
  failed: number;
  claimed: number;
}

/**
 * Processes up to `maxEvents` eligible events of the given types,
 * sequentially (one claim+process cycle at a time — no internal
 * concurrency), returning as soon as no more eligible events are found.
 * Safe to call directly from tests (no real worker process needed) and
 * from `apps/worker`'s own polling loop.
 */
export async function processPendingOutboxEvents(
  workerDb: Db,
  opts: { eventTypes: string[]; maxEvents?: number },
): Promise<ProcessPendingOutboxEventsResult> {
  const maxEvents = opts.maxEvents ?? 20;
  let processed = 0;
  let failed = 0;
  let claimed = 0;

  for (let i = 0; i < maxEvents; i++) {
    const event = await claimOneEvent(workerDb, opts.eventTypes);
    if (!event) break;
    claimed += 1;
    try {
      await processClaimedEvent(workerDb, event);
      processed += 1;
    } catch (err) {
      await markEventFailed(workerDb, event, err);
      failed += 1;
    }
  }

  return { processed, failed, claimed };
}
