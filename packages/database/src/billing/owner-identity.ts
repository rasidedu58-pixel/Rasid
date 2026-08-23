/**
 * Owner trial-identity hashing — Phase 8. Pure (no DB access).
 *
 * Normalizes + hashes a signup email into the `owner_trial_grants.email_hash`
 * lookup key — see schema/subscriptions.ts's own doc comment for why this
 * table exists and why it stores a hash, never the raw email.
 */
import { createHash } from "node:crypto";

/** Lowercase + trim only — no provider-specific normalization (e.g. Gmail's dot-insensitivity) is applied, since none is specified by any approved doc and inventing one would be a real anti-abuse business rule, not a technical detail. */
export function normalizeOwnerEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashOwnerEmail(email: string): string {
  return createHash("sha256").update(normalizeOwnerEmail(email), "utf8").digest("hex");
}
