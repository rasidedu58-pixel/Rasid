import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { runWithContext } from "@academic-precision/observability";
import type { Observable } from "rxjs";
import { AUTH_USER_REQUEST_KEY, type AuthenticatedRequest } from "../../identity/api/guards/supabase-auth.guard";
import { WORKSPACE_CONTEXT_REQUEST_KEY, type WorkspaceScopedRequest } from "../../team/api/guards/permission.guard";
import { REQUEST_ID_HEADER } from "../middleware/request-id.middleware";

type ContextualRequest = FastifyRequest & AuthenticatedRequest & WorkspaceScopedRequest;

/**
 * Registered globally (see main.ts, alongside `AllExceptionsFilter`). Runs
 * the rest of the request pipeline inside `runWithContext(...)` so
 * `userId`/`workspaceId`/`requestId` are available anywhere downstream
 * (notably `packages/database`'s `withRuntimeContext`) without threading
 * them through every function signature.
 *
 * Ordering: Nest always runs Guards before Interceptors' "before" logic
 * (Middleware → Guards → Interceptors → Pipes → Handler), even for
 * globally-registered interceptors — so by the time `intercept()` runs,
 * `SupabaseAuthGuard` has already set `request[AUTH_USER_REQUEST_KEY]` (on
 * any route behind it) and `PermissionGuard` has already set
 * `request[WORKSPACE_CONTEXT_REQUEST_KEY]` (Team module routes only).
 * Both are optional here — routes that don't hit those guards (e.g.
 * `/health`) simply run with `userId`/`workspaceId` left undefined, which
 * is fine: `getDb()`/`withRuntimeContext` calls with neither set just won't
 * set those session vars.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ContextualRequest>();

    const userId = request[AUTH_USER_REQUEST_KEY]?.id;
    const workspaceId = request[WORKSPACE_CONTEXT_REQUEST_KEY]?.workspaceId;
    const inboundRequestId = request.headers[REQUEST_ID_HEADER];
    const requestId = Array.isArray(inboundRequestId) ? inboundRequestId[0] : inboundRequestId;

    return runWithContext({ userId, workspaceId, requestId }, () => next.handle());
  }
}
