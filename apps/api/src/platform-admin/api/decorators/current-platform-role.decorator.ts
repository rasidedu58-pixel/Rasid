import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { PlatformRole } from "@academic-precision/contracts";
import { PLATFORM_ROLE_REQUEST_KEY } from "../guards/platform-admin.guard";

/**
 * Injects the caller's platform role (stashed by `PlatformAdminGuard`). Used by
 * endpoints whose response MIXES data of different sensitivities — e.g. the
 * dashboard/activity carry both customers-view content and subscription content
 * — so the service can redact the subscription portion for a role lacking
 * `platform.subscriptions.view`. Null only if the guard chain was misconfigured.
 */
export const CurrentPlatformRole = createParamDecorator((_data: unknown, context: ExecutionContext): PlatformRole | null => {
  const request = context.switchToHttp().getRequest<{ [PLATFORM_ROLE_REQUEST_KEY]?: PlatformRole }>();
  return request[PLATFORM_ROLE_REQUEST_KEY] ?? null;
});
