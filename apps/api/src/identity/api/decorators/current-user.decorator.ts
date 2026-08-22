import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { AUTH_USER_REQUEST_KEY, type AuthenticatedRequest } from "../guards/supabase-auth.guard";
import type { VerifiedSupabaseToken } from "../../infrastructure/jwt-token-verifier";

/** Reads the request's verified Supabase identity, set by SupabaseAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): VerifiedSupabaseToken => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request[AUTH_USER_REQUEST_KEY];
    if (!user) {
      throw new Error(
        "CurrentUser decorator used on a route not protected by SupabaseAuthGuard.",
      );
    }
    return user;
  },
);
