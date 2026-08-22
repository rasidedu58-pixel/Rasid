import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import {
  WORKSPACE_CONTEXT_REQUEST_KEY,
  type WorkspaceContext,
  type WorkspaceScopedRequest,
} from "../guards/permission.guard";

/** Reads the workspace context (workspaceId + caller membership) attached by PermissionGuard. */
export const CurrentWorkspaceContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceContext => {
    const request = context.switchToHttp().getRequest<WorkspaceScopedRequest>();
    const value = request[WORKSPACE_CONTEXT_REQUEST_KEY];
    if (!value) {
      throw new Error("CurrentWorkspaceContext decorator used on a route not protected by PermissionGuard.");
    }
    return value;
  },
);
