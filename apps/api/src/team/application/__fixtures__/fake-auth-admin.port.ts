import type { AuthAdminPort, AuthAdminUser, CreateAuthUserResult } from "../ports/auth-admin.port";

/**
 * In-memory `AuthAdminPort`. Records what a real GoTrue admin call WOULD
 * have received so the owner-creates-credentials flow can be exercised with
 * no network and no service-role key — including the two outcomes that
 * matter: a brand-new account, and an email that already exists (which must
 * never have its password rewritten).
 */
export class FakeAuthAdminPort implements AuthAdminPort {
  configured = true;
  /** Emails that already have an account before the test runs. */
  readonly existingByEmail = new Map<string, AuthAdminUser>();
  /** Every createUser call, in order — used to assert "no duplicate user". */
  readonly createCalls: Array<{ email: string; fullName: string; passwordLength: number }> = [];
  /** Forces the "auth host unreachable" branch. */
  unavailable = false;
  /** Forces the provider's own password rejection. */
  rejectPassword = false;

  isConfigured(): boolean {
    return this.configured;
  }

  async createUser(input: { email: string; password: string; fullName: string }): Promise<CreateAuthUserResult> {
    // Deliberately records only the LENGTH: a fixture that stored the
    // password would be the very thing this feature promises not to do.
    this.createCalls.push({ email: input.email, fullName: input.fullName, passwordLength: input.password.length });
    if (!this.configured || this.unavailable) return { ok: false, reason: "UNAVAILABLE" };
    if (this.rejectPassword) return { ok: false, reason: "WEAK_PASSWORD" };
    if (this.existingByEmail.has(input.email)) return { ok: false, reason: "EMAIL_TAKEN" };
    const user: AuthAdminUser = { id: `auth-${this.existingByEmail.size + 1}-${input.email}`, email: input.email };
    this.existingByEmail.set(input.email, user);
    return { ok: true, user };
  }

  async findUserByEmail(email: string): Promise<AuthAdminUser | null> {
    return this.existingByEmail.get(email) ?? null;
  }

  seedExisting(email: string, id = `existing-${email}`): AuthAdminUser {
    const user: AuthAdminUser = { id, email };
    this.existingByEmail.set(email, user);
    return user;
  }
}
