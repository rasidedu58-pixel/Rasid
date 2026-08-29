"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PermissionKey, CapabilityDto } from "@academic-precision/contracts";
import { fetchMe, fetchWorkspaceContext } from "./api/identity";
import { qk } from "./query-keys";
import { useSession } from "./session-provider";

/**
 * Phase 15 latency fix — the measured cold-load waterfall was
 * `/me` (≈3s) → `/context` (≈4.7s) STRICTLY SERIALIZED, because the
 * context query was gated on `/me`'s response. The active workspace id
 * changes essentially never for a real teacher, so we persist it and use
 * it as a HINT to fire `/context` in PARALLEL with `/me` on the next
 * load. `/me` remains the authority: if it resolves to a different
 * active workspace (rare — workspace switch/removal), the context query
 * key changes and refetches correctly; the hint fetch is simply
 * discarded. The id is not a secret (it appears in every API header).
 */
const LAST_WORKSPACE_KEY = "rasid.last-active-workspace-id";

function readCachedWorkspaceId(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

function writeCachedWorkspaceId(id: string) {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    /* storage unavailable — selection simply won't persist across reloads */
  }
}

/**
 * `/me` + `/context` describe slowly-changing identity/permission state —
 * a longer staleTime keeps SPA navigations from re-running the auth
 * waterfall. Mutations that change memberships/permissions already call
 * broad `queryClient.invalidateQueries()` on success, which resets these
 * regardless of staleTime. The backend stays the authority on every
 * mutation either way (§4.4/§4.5).
 */
const BOOTSTRAP_STALE_MS = 5 * 60_000;

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
  /**
   * Selects which of the caller's workspaces is the active/current one, and
   * persists that choice. Used both by the (future) workspace switcher and by
   * the invitation-accept flow — accepting an invite makes the invited
   * workspace current so the user lands directly in it, not their own.
   */
  setCurrentWorkspace: (workspaceId: string) => void;
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
  // The caller's explicitly-selected / last-active workspace. Seeded once on
  // mount from persisted storage (useState initializer — no SSR window access),
  // then updated by `setCurrentWorkspace` (workspace switch / invite accept).
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : readCachedWorkspaceId(),
  );

  const meQuery = useQuery({
    queryKey: qk.me(),
    queryFn: fetchMe,
    enabled: sessionStatus === "authenticated",
    staleTime: BOOTSTRAP_STALE_MS,
  });

  // Prefer the caller's selected workspace WHEN it is still one of their
  // ACTIVE memberships; otherwise fall back to the first ACTIVE one. `/me`
  // (membership status) remains authoritative — a stale/left selection can
  // never resurrect a workspace the user is no longer an active member of.
  // This is exactly what makes an accepted invitation's workspace become the
  // current one (the accept flow calls `setCurrentWorkspace` first).
  const activeMemberships = (meQuery.data?.workspaces ?? []).filter((w) => w.status === "ACTIVE");
  const activeWorkspace =
    (selectedWorkspaceId ? activeMemberships.find((w) => w.id === selectedWorkspaceId) : undefined) ??
    activeMemberships[0] ??
    null;

  // Before `/me` resolves, the persisted selection is only a parallelization
  // hint for `/context`. Once `/me` has resolved with NO active workspace, the
  // hint must NOT keep a context fetch alive.
  const contextWorkspaceId = activeWorkspace?.id ?? (meQuery.data ? null : selectedWorkspaceId);

  const contextQuery = useQuery({
    queryKey: contextWorkspaceId ? qk.workspaceContext(contextWorkspaceId) : ["workspace-context", "none"],
    queryFn: () => fetchWorkspaceContext(contextWorkspaceId!),
    enabled: sessionStatus === "authenticated" && !!contextWorkspaceId,
    staleTime: BOOTSTRAP_STALE_MS,
  });

  // Keep the persisted "last active" in sync with whatever active workspace is
  // actually resolved, so the next cold load restores the same one.
  useEffect(() => {
    if (activeWorkspace) writeCachedWorkspaceId(activeWorkspace.id);
  }, [activeWorkspace]);

  const setCurrentWorkspace = useCallback((workspaceId: string) => {
    writeCachedWorkspaceId(workspaceId);
    setSelectedWorkspaceId(workspaceId);
  }, []);

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
        setCurrentWorkspace,
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
        setCurrentWorkspace,
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
      setCurrentWorkspace,
    };
  }, [sessionStatus, meQuery, contextQuery, activeWorkspace, setCurrentWorkspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
