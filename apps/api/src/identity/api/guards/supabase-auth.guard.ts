import { CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { SessionExpiredException, UnauthenticatedException } from "../../../common/exceptions/api.exception";
import {
  TOKEN_VERIFIER,
  TokenExpiredVerificationError,
  type TokenVerifier,
  type VerifiedSupabaseToken,
} from "../../infrastructure/jwt-token-verifier";

export const AUTH_USER_REQUEST_KEY = "authUser";

export interface AuthenticatedRequest extends FastifyRequest {
  [AUTH_USER_REQUEST_KEY]?: VerifiedSupabaseToken;
}

/**
 * Verifies the bearer token against Supabase's issued-JWT secret and
 * attaches the verified user id to the request context. No client-supplied
 * header/body value is ever trusted as identity — only the verified `sub`
 * claim from a signature-checked token.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly tokenVerifier: TokenVerifier) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthenticatedException();
    }

    try {
      request[AUTH_USER_REQUEST_KEY] = this.tokenVerifier.verify(token);
    } catch (error) {
      if (error instanceof TokenExpiredVerificationError) {
        throw new SessionExpiredException();
      }
      throw new UnauthenticatedException();
    }

    return true;
  }

  private extractBearerToken(header: string | string[] | undefined): string | undefined {
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.startsWith("Bearer ")) {
      return undefined;
    }
    const token = value.slice("Bearer ".length).trim();
    return token.length > 0 ? token : undefined;
  }
}
