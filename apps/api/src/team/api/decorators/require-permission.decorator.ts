import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@academic-precision/contracts";

export const REQUIRED_PERMISSION_METADATA_KEY = "requiredPermission";

/**
 * Marks a route as requiring `permission` in the caller's effective
 * permission set for the workspace resolved by `PermissionGuard` (the
 * `X-Workspace-Id` header — API Contract §5.1). Must be combined with
 * `@UseGuards(SupabaseAuthGuard, PermissionGuard)`.
 */
export const RequirePermission = (permission: PermissionKey) =>
  SetMetadata(REQUIRED_PERMISSION_METADATA_KEY, permission);
