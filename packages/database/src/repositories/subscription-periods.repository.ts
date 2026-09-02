/**
 * subscription_periods repository — Billing Engine, Phase 4. Append + read of the
 * immutable commercial period ledger. All writes happen INSIDE a caller's
 * transaction (the payment-confirm / downgrade flows) so they compose atomically;
 * there is no standalone "update"/"delete" — the ledger is append-only.
 */
import { asc, eq } from "drizzle-orm";
import { subscriptionPeriods } from "../schema/subscription-periods";
import type { Db } from "./identity.repository";
import type { LedgerPeriodRow } from "../billing/period-ledger";

export type SubscriptionPeriodRow = typeof subscriptionPeriods.$inferSelect;

export interface AppendPeriodInput {
  workspaceId: string;
  subscriptionId: string;
  planCode: string;
  billingCycle: string;
  cyclePriceMinor: number;
  currencyCode: string;
  planPriceVersion: number | null;
  periodStart: Date;
  periodEnd: Date;
  nominalCycleStart: Date;
  nominalCycleEnd: Date;
  sourceAction: "NEW_SUBSCRIPTION" | "RENEWAL" | "UPGRADE";
  sourcePaymentId: string | null;
  supersedesPeriodId: string | null;
  /** Agreed CUSTOM capacity — required for a CUSTOM period, must be null otherwise (0069). */
  customMaxActiveStudents?: number | null;
  customMaxTeamMembers?: number | null;
}

/** Append one immutable period row on the caller's tx. */
export async function appendSubscriptionPeriodOnTx(tx: Db, input: AppendPeriodInput): Promise<SubscriptionPeriodRow> {
  const [row] = await tx
    .insert(subscriptionPeriods)
    .values({
      workspaceId: input.workspaceId,
      subscriptionId: input.subscriptionId,
      planCode: input.planCode,
      billingCycle: input.billingCycle,
      cyclePriceMinor: input.cyclePriceMinor,
      currencyCode: input.currencyCode,
      planPriceVersion: input.planPriceVersion,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      nominalCycleStart: input.nominalCycleStart,
      nominalCycleEnd: input.nominalCycleEnd,
      sourceAction: input.sourceAction,
      customMaxActiveStudents: input.customMaxActiveStudents ?? null,
      customMaxTeamMembers: input.customMaxTeamMembers ?? null,
      sourcePaymentId: input.sourcePaymentId,
      supersedesPeriodId: input.supersedesPeriodId,
    })
    .returning();
  if (!row) throw new Error("Failed to insert subscription_periods row.");
  return row;
}

/** All ledger rows for a subscription (ascending seq), mapped to epoch-ms `LedgerPeriodRow`s for the pure resolver. */
export async function loadLedgerRowsForSubscription(db: Db, subscriptionId: string): Promise<LedgerPeriodRow[]> {
  const rows = await db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.subscriptionId, subscriptionId))
    .orderBy(asc(subscriptionPeriods.seq));
  return rows.map(toLedgerRow);
}

export function toLedgerRow(r: SubscriptionPeriodRow): LedgerPeriodRow {
  return {
    id: r.id,
    seq: Number(r.seq),
    planCode: r.planCode,
    billingCycle: r.billingCycle,
    cyclePriceMinor: Number(r.cyclePriceMinor),
    planPriceVersion: r.planPriceVersion ?? null,
    customMaxActiveStudents: r.customMaxActiveStudents ?? null,
    customMaxTeamMembers: r.customMaxTeamMembers ?? null,
    periodStartMs: r.periodStart.getTime(),
    periodEndMs: r.periodEnd.getTime(),
    nominalCycleStartMs: r.nominalCycleStart.getTime(),
    nominalCycleEndMs: r.nominalCycleEnd.getTime(),
  };
}

/** Tenant-facing list of a workspace's own periods (newest first) — read-only. */
export function listSubscriptionPeriodsForWorkspace(db: Db, workspaceId: string): Promise<SubscriptionPeriodRow[]> {
  return db
    .select()
    .from(subscriptionPeriods)
    .where(eq(subscriptionPeriods.workspaceId, workspaceId))
    .orderBy(asc(subscriptionPeriods.seq));
}
