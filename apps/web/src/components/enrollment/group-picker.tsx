"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button, Input, Popover, PopoverContent, PopoverTrigger, Skeleton, cn } from "@academic-precision/ui";
import { fetchGroups } from "../../lib/api/scheduling";
import { qk } from "../../lib/query-keys";
import { useWorkspace } from "../../lib/workspace-provider";

/**
 * Searchable Group selector for the enrollment flows. There is no combobox
 * primitive in the design system yet, so this composes Popover + Input + a
 * filtered list (client-side filter over `GET /groups`, which returns the
 * workspace's groups in one call and is scope-filtered server-side — a user
 * only ever sees the groups they may act on). Only ACTIVE groups are offered
 * (archived groups can't take new enrollments). Each row shows the group name
 * plus its subject/grade when present — nothing heavier.
 */
export function GroupPicker({
  value,
  onChange,
  allowNone = true,
  noneLabel = "بدون مجموعة الآن",
  disabled = false,
  triggerId,
}: {
  value: string | null;
  onChange: (groupId: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  triggerId?: string;
}) {
  const { workspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const groupsQuery = useQuery({
    queryKey: workspaceId ? qk.groups.list(workspaceId) : ["groups", "none"],
    queryFn: () => fetchGroups(workspaceId!),
    enabled: !!workspaceId,
  });

  const activeGroups = useMemo(
    () => (groupsQuery.data?.groups ?? []).filter((g) => g.status === "ACTIVE"),
    [groupsQuery.data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeGroups;
    return activeGroups.filter((g) =>
      [g.name, g.subject, g.grade].filter(Boolean).some((v) => v!.toLowerCase().includes(q)),
    );
  }, [activeGroups, search]);

  const selected = activeGroups.find((g) => g.id === value) ?? null;
  const selectedLabel = selected
    ? [selected.name, [selected.subject, selected.grade].filter(Boolean).join(" · ")].filter(Boolean).join(" — ")
    : allowNone
      ? noneLabel
      : "اختر مجموعة";

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          id={triggerId}
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-between font-normal"
          aria-expanded={open}
        >
          <span className={cn("truncate", !selected && "text-text-tertiary")}>{selectedLabel}</span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن مجموعة..."
              className="h-9 ps-8"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {groupsQuery.isLoading ? (
            <div className="flex flex-col gap-1 p-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <>
              {allowNone ? (
                <RowButton
                  active={value === null}
                  onClick={() => { onChange(null); setOpen(false); }}
                  title={noneLabel}
                />
              ) : null}
              {filtered.map((g) => (
                <RowButton
                  key={g.id}
                  active={value === g.id}
                  onClick={() => { onChange(g.id); setOpen(false); }}
                  title={g.name}
                  subtitle={[g.subject, g.grade].filter(Boolean).join(" · ") || undefined}
                />
              ))}
              {!groupsQuery.isLoading && activeGroups.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-text-tertiary">لا توجد مجموعات متاحة.</p>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-text-tertiary">لا توجد نتائج مطابقة.</p>
              ) : null}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RowButton({ active, onClick, title, subtitle }: { active: boolean; onClick: () => void; title: string; subtitle?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-surface-sunken",
        active && "bg-surface-sunken",
      )}
    >
      <span className="flex flex-col">
        <span className="text-text-primary">{title}</span>
        {subtitle ? <span className="text-xs text-text-tertiary">{subtitle}</span> : null}
      </span>
      {active ? <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden /> : null}
    </button>
  );
}
