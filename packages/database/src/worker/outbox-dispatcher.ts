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
 *
 * Phase 10 hardening — bounded retry / terminal `DEAD` status (migration
 * 0045). Before this, a "poison" event (permanently invalid — e.g. a
 * payload referencing an already-deleted Session) could retry FOREVER:
 * `attempt_count` kept climbing with a capped 10-minute backoff, but
 * nothing ever stopped the cycle. This never starved OTHER events (the
 * claim query always picks whichever due row has the earliest
 * `available_at`, and a backed-off poison event usually isn't due), but it
 * would consume a worker cycle indefinitely for a row nothing can ever fix
 * automatically. Once `attempt_count` reaches `MAX_ATTEMPTS`, the row is
 * marked `DEAD` instead of `FAILED` — never discarded, never claimed again
 * by the normal poll loop, inspectable directly
 * (`SELECT * FROM outbox_events WHERE status = 'DEAD'`), and explicitly
 * replayable by an operator via `replayDeadOutboxEvent` once the
 * underlying cause is fixed.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { outboxEvents } from "../schema/outbox";
import { withWorkerRuntimeContext } from "../connection";
import type { Db } from "../repositories/identity.repository";
import { runEvaluateAttentionRulesForSessionTransaction } from "../repositories/attention.repository";

const LEASE_MS = 2 * 60 * 1000; // 2 minutes — generous for a single-session evaluation.
const MAX_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes cap.
const BASE_BACKOFF_MS = 30 * 1000; // 30 seconds per attempt.
/** After this many attempts, a still-failing event goes DEAD (terminal) instead of FAILED-and-retried-again. At the backoff cap (10 min), 10 attempts is up to ~100 minutes of automatic retry before requiring operator intervention — long enough to ride out a transient dependency outage, short enough not to loop forever on a truly poison event. */
const MAX_ATTEMPTS = 10;

export type OutboxEventRow = typeof outboxEvents.$inferSelect;

/**
 * The outbox event types the worker actually consumes — the SINGLE source of
 * truth. `apps/worker` polls exactly these, and any health/queue metric that
 * asks "is the worker behind?" must scope to these too: an event type with no
 * consumer (e.g. `MonthCreated`, produced for future use) sits PENDING forever
 * by design and must NEVER be counted as a worker backlog. One list so the two
 * consumers can never drift apart.
 */
export const WORKER_CONSUMED_EVENT_TYPES = ["SessionCompleted"] as const;

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

/** Step 3 — mark a claimed event FAILED (with a backoff delay) or, once `MAX_ATTEMPTS` is exhausted, terminally DEAD — in its own small transaction (never inside the failed processing transaction itself, which just rolled back). */
async function markEventFailed(workerDb: Db, event: OutboxEventRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (event.attemptCount >= MAX_ATTEMPTS) {
    await workerDb
      .update(outboxEvents)
      .set({ status: "DEAD", lastError: message.slice(0, 2000) })
      .where(eq(outboxEvents.id, event.id));
    return;
  }
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

/**
 * Operator recovery/replay procedure (Phase 10) — the ONLY way a DEAD
 * event is ever picked up again. Resets `attempt_count` to 0 and `status`
 * to `PENDING` with `available_at = now()`, so the very next poll cycle
 * claims it immediately. Callable manually (a one-off script/REPL against
 * the worker connection) once the underlying cause has actually been
 * fixed — never automatic, since an unconditionally-auto-replayed poison
 * event would just go DEAD again after the same `MAX_ATTEMPTS` retries.
 */
export async function replayDeadOutboxEvent(workerDb: Db, eventId: string): Promise<OutboxEventRow | undefined> {
  const [row] = await workerDb
    .update(outboxEvents)
    .set({ status: "PENDING", attemptCount: 0, availableAt: sql`now()`, lastError: null })
    .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.status, "DEAD")))
    .returning();
  return row;
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
  /** How many of `failed` went terminal (DEAD) this cycle, not just backed-off-and-retried — surfaced separately so an operator/dashboard can alert on it specifically. */
  dead: number;
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
  let dead = 0;
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
      if (event.attemptCount >= MAX_ATTEMPTS) dead += 1;
    }
  }

  return { processed, failed, claimed, dead };
}
