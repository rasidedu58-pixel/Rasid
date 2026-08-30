"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Input, Skeleton, cn } from "@academic-precision/ui";
import { Building2, Search, UserRound } from "lucide-react";
import { useDebounce } from "../../hooks/use-debounce";
import { fetchPlatformAdminWorkspaces, fetchPlatformAdminUsers } from "../../lib/api/platform-admin";
import { SUB_STATE_LABEL, subStateTone } from "../../lib/platform-labels";

/**
 * Global platform search — "a teacher called me: find them in seconds by name,
 * email or phone". Searches workspaces + users in parallel and shows a compact,
 * command-style result list linking straight to the customer's 360 view.
 * Read-only; backed by the scope-checked platform-admin list endpoints.
 */
export function PlatformSearch() {
  const [term, setTerm] = useState("");
  const q = useDebounce(term.trim(), 300);
  const enabled = q.length >= 2;

  const workspacesQuery = useQuery({
    queryKey: ["platform-search", "workspaces", q],
    queryFn: () => fetchPlatformAdminWorkspaces({ search: q, limit: 6 }),
    enabled,
  });
  const usersQuery = useQuery({
    queryKey: ["platform-search", "users", q],
    queryFn: () => fetchPlatformAdminUsers({ search: q, limit: 6 }),
    enabled,
  });

  const loading = enabled && (workspacesQuery.isLoading || usersQuery.isLoading);
  const workspaces = workspacesQuery.data?.items ?? [];
  const users = usersQuery.data?.items ?? [];
  const empty = enabled && !loading && workspaces.length === 0 && users.length === 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="ابحث عن عميل بالاسم أو البريد أو الهاتف أو اسم مساحة العمل…"
          className="h-11 ps-9"
          aria-label="بحث عن عميل"
        />
      </div>

      {enabled ? (
        <div className="mt-3 flex flex-col gap-3">
          {loading ? (
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : empty ? (
            <p className="px-1 py-3 text-center text-sm text-text-tertiary">لا توجد نتائج مطابقة.</p>
          ) : (
            <>
              {workspaces.length > 0 ? (
                <div>
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">مساحات العمل</p>
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {workspaces.map((w) => (
                      <li key={w.id}>
                        <Link href={`/platform-admin/workspaces/${w.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-sunken">
                          <span className="flex items-center gap-2.5">
                            <Building2 className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                            <span className="flex flex-col">
                              <span className="font-medium text-text-primary">{w.name}</span>
                              <span className="text-xs text-text-tertiary">{w.ownerName ?? "—"}</span>
                            </span>
                          </span>
                          {w.subscriptionState ? (
                            <Badge tone={subStateTone(w.subscriptionState)}>{SUB_STATE_LABEL[w.subscriptionState] ?? w.subscriptionState}</Badge>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {users.length > 0 ? (
                <div>
                  <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">المستخدمون</p>
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {users.map((u) => (
                      <li key={u.id}>
                        <Link href={`/platform-admin/users/${u.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-sunken">
                          <span className="flex items-center gap-2.5">
                            <UserRound className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                            <span className="flex flex-col">
                              <span className="font-medium text-text-primary">{u.fullName}</span>
                              <span className="text-xs text-text-tertiary">{u.emailDisplay ?? "—"}</span>
                            </span>
                          </span>
                          <span className={cn("text-xs text-text-tertiary")}>{u.workspaceCount} مساحة</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <p className="mt-2 px-1 text-xs text-text-tertiary">اكتب حرفين على الأقل للبحث.</p>
      )}
    </div>
  );
}
