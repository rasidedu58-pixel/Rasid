/**
 * Creating a sign-in account for an invited team member.
 *
 * The owner chooses the member's email and password, so Rasid has to create
 * the auth account on their behalf. That is the ONLY thing this port does —
 * it is deliberately two narrow operations, not a general admin client, so
 * the privileged credential behind it can never be reached for anything else
 * from application code.
 *
 * What it never does, by design:
 *   * store, log, echo or return a password — `createUser` takes one and
 *     returns only an id, and no read anywhere can produce it again;
 *   * touch an existing account's password. `findUserByEmail` exists so the
 *     service can detect that case and link the invitation to the account
 *     that already exists instead of overwriting anyone's credentials.
 */
export interface AuthAdminUser {
  id: string;
  email: string | null;
}

export type CreateAuthUserResult =
  | { ok: true; user: AuthAdminUser }
  | { ok: false; reason: "EMAIL_TAKEN" | "WEAK_PASSWORD" | "UNAVAILABLE"; message?: string };

export interface AuthAdminPort {
  /** False when the deployment has no admin credential configured — the caller must degrade, never crash. */
  isConfigured(): boolean;
  /** Creates a confirmed account. `EMAIL_TAKEN` is a normal outcome, not an error. */
  createUser(input: { email: string; password: string; fullName: string }): Promise<CreateAuthUserResult>;
  /** The existing account for an email, if any. Never reveals anything but id/email. */
  findUserByEmail(email: string): Promise<AuthAdminUser | null>;
}

export const AUTH_ADMIN_PORT = Symbol("AUTH_ADMIN_PORT");
