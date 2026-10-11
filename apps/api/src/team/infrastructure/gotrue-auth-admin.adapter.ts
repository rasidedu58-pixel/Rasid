import { Inject, Injectable } from "@nestjs/common";
import type { ServerEnv } from "@academic-precision/config";
import { API_ENV } from "../../config/config.module";
import type { AuthAdminPort, AuthAdminUser, CreateAuthUserResult } from "../application/ports/auth-admin.port";

/**
 * `AuthAdminPort` over GoTrue's admin REST API — the same endpoint whether
 * auth is hosted Supabase or the self-hosted GoTrue on the VPS, because both
 * speak `{SUPABASE_URL}/auth/v1/admin/users`.
 *
 * The service-role key is read once from the environment and used for
 * nothing but these two calls. It is deliberately NOT turned into a general
 * Supabase client: that key bypasses RLS on every table, and the only
 * legitimate need here is creating a sign-in account the owner has decided
 * on. No database access goes anywhere near it.
 *
 * `isConfigured()` is false when the key (or URL) is absent, which is the
 * state of a deployment that has not opted in. Callers degrade to the
 * link-only invitation instead of failing — that is why the key stays
 * optional in the config schema.
 *
 * Nothing here logs the request body. The observability redactor already
 * masks `password` / `service_role`, but the body is never handed to a
 * logger in the first place.
 */
@Injectable()
export class GoTrueAuthAdminAdapter implements AuthAdminPort {
  constructor(@Inject(API_ENV) private readonly env: ServerEnv) {}

  isConfigured(): boolean {
    return !!this.env.SUPABASE_URL && !!this.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  private headers(): Record<string, string> {
    const key = this.env.SUPABASE_SERVICE_ROLE_KEY as string;
    return {
      "Content-Type": "application/json",
      // GoTrue wants both; hosted Supabase requires `apikey` as well.
      apikey: key,
      Authorization: `Bearer ${key}`,
    };
  }

  private adminUrl(path: string): string {
    return `${(this.env.SUPABASE_URL as string).replace(/\/+$/, "")}/auth/v1/admin/${path}`;
  }

  async createUser(input: { email: string; password: string; fullName: string }): Promise<CreateAuthUserResult> {
    if (!this.isConfigured()) return { ok: false, reason: "UNAVAILABLE" };

    let response: Response;
    try {
      response = await fetch(this.adminUrl("users"), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          // The owner vouches for the member; there is no inbox round-trip to
          // wait for, and the member must be able to sign in immediately.
          email_confirm: true,
          user_metadata: { full_name: input.fullName },
        }),
      });
    } catch {
      // Network/DNS/TLS — the auth host is unreachable. Never a 500 with a
      // stack trace; the caller turns this into a clear owner-facing message.
      return { ok: false, reason: "UNAVAILABLE" };
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
      if (!body || typeof body.id !== "string") return { ok: false, reason: "UNAVAILABLE" };
      return { ok: true, user: { id: body.id, email: typeof body.email === "string" ? body.email : input.email } };
    }

    const text = await response.text().catch(() => "");
    // GoTrue answers 422 for both "already registered" and "password too
    // short"; the two need different words in front of the owner.
    if (/already.*registered|already.*exists|email_exists|duplicate/i.test(text)) {
      return { ok: false, reason: "EMAIL_TAKEN" };
    }
    if (response.status === 422 && /password/i.test(text)) {
      return { ok: false, reason: "WEAK_PASSWORD" };
    }
    return { ok: false, reason: "UNAVAILABLE" };
  }

  async findUserByEmail(email: string): Promise<AuthAdminUser | null> {
    if (!this.isConfigured()) return null;
    try {
      const url = `${this.adminUrl("users")}?filter=${encodeURIComponent(email)}&per_page=50`;
      const response = await fetch(url, { method: "GET", headers: this.headers() });
      if (!response.ok) return null;
      const body = (await response.json().catch(() => null)) as { users?: Array<{ id?: unknown; email?: unknown }> } | null;
      const match = body?.users?.find((u) => typeof u.email === "string" && u.email.toLowerCase() === email.toLowerCase());
      if (!match || typeof match.id !== "string") return null;
      return { id: match.id, email: typeof match.email === "string" ? match.email : email };
    } catch {
      return null;
    }
  }
}
