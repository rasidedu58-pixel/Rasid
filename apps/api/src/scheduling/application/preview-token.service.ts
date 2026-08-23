import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ValidationApiException } from "../../common/exceptions/api.exception";

const PREVIEW_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PreviewTokenRecord<T> {
  kind: string;
  workspaceId: string;
  payload: T;
  expiresAt: Date;
}

/**
 * Server-side cached preview-token store (API Contract §11.4: "Preview
 * ليس Authorization" — the server MUST re-validate everything at apply
 * time, never trust a client-supplied payload). The token handed to the
 * client is a genuinely opaque, unguessable id (`randomUUID()`); all real
 * state (the exact plan being previewed) stays server-side, keyed by that
 * id, with an expiry and workspace binding. Consumption is one-time
 * (`consume` deletes the record) so a preview token can never be replayed.
 *
 * DEPLOYMENT NOTE (documented open item — see Phase 3 handoff): this store
 * is in-process memory, appropriate for a single-instance deployment/test
 * environment. A multi-instance production deployment would need a shared
 * store (e.g. Redis) instead — flagged for the orchestrator, not attempted
 * here since no new infrastructure dependency was pre-authorized for this
 * phase.
 */
@Injectable()
export class PreviewTokenService {
  private readonly store = new Map<string, PreviewTokenRecord<unknown>>();

  issue<T>(kind: string, workspaceId: string, payload: T): { token: string; expiresAt: Date } {
    this.sweepExpired();
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + PREVIEW_TOKEN_TTL_MS);
    this.store.set(token, { kind, workspaceId, payload, expiresAt });
    return { token, expiresAt };
  }

  /** One-time consumption: throws ValidationApiException on any mismatch (unknown/expired/wrong kind/wrong workspace). */
  consume<T>(kind: string, workspaceId: string, token: string): T {
    const record = this.store.get(token);
    // Always delete on first lookup attempt — a token is single-use even
    // when the lookup itself fails validation, preventing retry-probing.
    if (record) this.store.delete(token);

    if (
      !record ||
      record.kind !== kind ||
      record.workspaceId !== workspaceId ||
      record.expiresAt.getTime() < Date.now()
    ) {
      throw new ValidationApiException({ previewToken: ["رمز المعاينة غير صالح أو منتهي الصلاحية."] });
    }
    return record.payload as T;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [token, record] of this.store.entries()) {
      if (record.expiresAt.getTime() < now) this.store.delete(token);
    }
  }
}
