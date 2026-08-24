"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PermissionKey, CapabilityDto } from "@academic-precision/contracts";
import { fetchMe, fetchWorkspaceContext } from "./api/identity";
import { qk } from "./query-keys";
import { useSession } from "./session-provider";

interface WorkspaceContextValue {
  status: "loading" | "ready" | "no-workspace" | "error";
  workspaceId: string | null;
  workspaceName: string | null;
  timezone: string | null;
  roleLabel: string | null;
  permissions: ReadonlySet<string>;
  entitlements: ReadonlySet<string>;
  subscriptionState: string | null;
  isOwner: boolean;
  hasPermission: (key: PermissionKey) => boolean;
  canWrite: (capability?: CapabilityDto) => boolean;
  refetch: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const WRITE_BLOCKING_STATES = new Set(["EXPIRED", "PAYMENT_FAILED"]);

/**
 * Loads `/me` then the active workspace's `/context` (real permissions +
 * entitlements + subscriptionState — Phase 11 backend fix, see
 * `identity.service.ts`). Every screen reads permission/entitlement state
 * from here rather than re-deriving it, so "hide a button the user cannot
 * use" logic lives in ONE place — the backend remains the actual
 * authority on every mutation regardless (§4.4/§4.5).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { status: sessionStatus } = useSession();

  const meQuery = useQuery({
    queryKey: qk.me(),
    queryFn: fetchMe,
    enabled: sessionStatus === "authenticated",
  });

  const activeWorkspace = meQuery.data?.workspaces.find((w) => w.status === "ACTIVE") ?? null;

  const contextQuery = useQuery({
    queryKey: activeWorkspace ? qk.workspaceContext(activeWorkspace.id) : ["workspace-context", "none"],
    queryFn: () => fetchWorkspaceContext(activeWorkspace!.id),
    enabled: !!activeWorkspace,
  });

  const value = useMemo<WorkspaceContextValue>(() => {
    if (sessionStatus === "loading" || meQuery.isLoading || (activeWorkspace && contextQuery.isLoading)) {
      return {
        status: "loading",
        workspaceId: null,
        workspaceName: null,
        timezone: null,
        roleLabel: null,
        permissions: new Set(),
        entitlements: new Set(),
        subscriptionState: null,
        isOwner: false,
        hasPermission: () => false,
        canWrite: () => false,
        refetch: () => {
          void meQuery.refetch();
          void contextQuery.refetch();
        },
      };
    }

    if (!activeWorkspace) {
      return {
        status: meQuery.isError ? "error" : "no-workspace",
        workspaceId: null,
        workspaceName: null,
        timezone: null,
        roleLabel: null,
        permissions: new Set(),
        entitlements: new Set(),
        subscriptionState: null,
        isOwner: false,
        hasPermission: () => false,
        canWrite: () => false,
        refetch: () => void meQuery.refetch(),
      };
    }

    const permissions = new Set(contextQuery.data?.permissions ?? []);
    const entitlements = new Set(contextQuery.data?.entitlements ?? []);
    const subscriptionState = contextQuery.data?.subscriptionState ?? null;
    const roleLabel = contextQuery.data?.membership.roleLabel ?? null;

    return {
      status: contextQuery.isError ? "error" : "ready",
      workspaceId: activeWorkspace.id,
      workspaceName: contextQuery.data?.workspace.name ?? activeWorkspace.name,
      timezone: contextQuery.data?.workspace.timezone ?? null,
      roleLabel,
      permissions,
      entitlements,
      subscriptionState,
      isOwner: roleLabel === "OWNER",
      hasPermission: (key) => permissions.has(key),
      // No capability arg => "is the workspace writable at all right now".
      // WRITE_BLOCKING_STATES mirrors the backend's own entitlement matrix
      // (EXPIRED/PAYMENT_FAILED block all 4 capabilities together) — this
      // is UI guidance only, the EntitlementGuard is the real authority.
      canWrite: (capability) => {
        if (subscriptionState && WRITE_BLOCKING_STATES.has(subscriptionState)) return false;
        if (!capability) return true;
        return entitlements.has(capability);
      },
      refetch: () => void contextQuery.refetch(),
    };
  }, [sessionStatus, meQuery, contextQuery, activeWorkspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
