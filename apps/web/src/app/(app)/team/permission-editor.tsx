"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Search, ShieldAlert, Check } from "lucide-react";
import {
  PERMISSION_SCOPE_KIND,
  OWNER_ONLY_PERMISSION_KEYS,
  closurePermissionKeys,
  type PermissionKey,
  type TeamMember,
  type DesiredGrant,
} from "@academic-precision/contracts";
import { Button, Badge, Switch, cn, toast } from "@academic-precision/ui";
import { qk } from "../../../lib/query-keys";
import { updateMembershipPermissions } from "../../../lib/api/team";
import { PERMISSION_CATEGORIES, RISKY_PERMISSIONS, ROLE_PRESETS } from "./permission-catalog-ui";

interface Group {
  id: string;
  name: string;
}

/** Group-scoped permissions can be narrowed to specific groups; workspace ones can't. */
function isGroupScoped(key: PermissionKey) {
  return PERMISSION_SCOPE_KIND[key] === "GROUP";
}

/** Editable categories exclude the owner-only `team.manage` (never grantable to a member). */
const EDITABLE_CATEGORIES = PERMISSION_CATEGORIES.map((c) => ({
  ...c,
  permissions: c.permissions.filter((p) => !OWNER_ONLY_PERMISSION_KEYS.has(p.key)),
})).filter((c) => c.permissions.length > 0);

function initialScope(member: TeamMember): { scope: "ALL_GROUPS" | "SELECTED_GROUPS"; groupIds: Set<string> } {
  const selected = new Set<string>();
  let anySelected = false;
  for (const g of member.grants) {
    if (g.scope === "SELECTED_GROUPS") {
      anySelected = true;
      (g.groupIds ?? []).forEach((id) => selected.add(id));
    }
  }
  // If every grant is ALL_GROUPS (or there are none), the member is workspace-wide.
  const allAll = member.grants.length > 0 && member.grants.every((g) => g.scope === "ALL_GROUPS");
  return { scope: anySelected && !allAll ? "SELECTED_GROUPS" : "ALL_GROUPS", groupIds: selected };
}

export function PermissionEditor({
  workspaceId,
  member,
  groups,
  onSaved,
}: {
  workspaceId: string;
  member: TeamMember;
  groups: Group[];
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const init = useMemo(() => initialScope(member), [member]);

  const [enabled, setEnabled] = useState<Set<PermissionKey>>(() => new Set(member.grants.map((g) => g.permission)));
  const [scope, setScope] = useState<"ALL_GROUPS" | "SELECTED_GROUPS">(init.scope);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(init.groupIds);
  const [open, setOpen] = useState<Set<string>>(() => new Set(EDITABLE_CATEGORIES.map((c) => c.key)));
  const [groupQuery, setGroupQuery] = useState("");

  const save = useMutation({
    mutationFn: () => {
      // Expand the dependency closure so the sent grant set is always coherent.
      const effective = new Set<PermissionKey>();
      for (const key of enabled) for (const dep of closurePermissionKeys(key)) effective.add(dep);
      const grants: DesiredGrant[] = [...effective].map((permission) => {
        if (isGroupScoped(permission) && scope === "SELECTED_GROUPS") {
          return { permission, scope: "SELECTED_GROUPS", groupIds: [...selectedGroups] };
        }
        return { permission, scope: "ALL_GROUPS" };
      });
      return updateMembershipPermissions(workspaceId, member.id, { grants });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.team.list(workspaceId) });
      toast.success("تم حفظ الصلاحيات");
      onSaved?.();
    },
    onError: () => toast.error("تعذّر حفظ الصلاحيات"),
  });

  function toggle(key: PermissionKey, on: boolean) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (on) {
        for (const dep of closurePermissionKeys(key)) next.add(dep); // pull in dependencies
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function applyPreset(keys: PermissionKey[]) {
    const next = new Set<PermissionKey>();
    for (const key of keys) for (const dep of closurePermissionKeys(key)) next.add(dep);
    setEnabled(next);
  }

  const scopeNeedsGroups = scope === "SELECTED_GROUPS";
  const filteredGroups = groups.filter((g) => g.name.includes(groupQuery.trim()));
  const grantsUseGroupScope = [...enabled].some(isGroupScoped);

  return (
    <div className="flex flex-col gap-6">
      {/* Role presets */}
      <div>
        <p className="mb-2 text-sm font-semibold text-text-primary">ابدأ من دور جاهز</p>
        <div className="flex flex-wrap gap-2">
          {ROLE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset.permissions)}
              title={preset.description}
              className="focus-ring rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-primary transition-colors hover:border-brand/40 hover:bg-brand-subtle/40"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Group scope — one member-level choice applied to all group-scoped permissions */}
      {grantsUseGroupScope ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-text-primary">نطاق الوصول</p>
          <p className="mt-0.5 text-xs text-text-secondary">على أي مجموعات تُطبَّق صلاحياته المرتبطة بالمجموعات؟</p>
          <div className="mt-3 flex gap-2">
            {(["ALL_GROUPS", "SELECTED_GROUPS"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={cn(
                  "focus-ring flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                  scope === s ? "border-brand bg-brand-subtle/50 font-medium text-brand-subtle-foreground" : "border-border text-text-secondary hover:bg-surface-sunken",
                )}
              >
                {s === "ALL_GROUPS" ? "كل المجموعات" : "مجموعات محددة"}
              </button>
            ))}
          </div>

          {scopeNeedsGroups ? (
            <div className="mt-3">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
                <input
                  value={groupQuery}
                  onChange={(e) => setGroupQuery(e.target.value)}
                  placeholder="ابحث عن مجموعة…"
                  aria-label="ابحث عن مجموعة"
                  className="focus-ring h-9 w-full rounded-md border border-border bg-surface pe-9 ps-3 text-sm text-text-primary placeholder:text-text-tertiary"
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border">
                {filteredGroups.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-text-tertiary">لا توجد مجموعات مطابقة.</p>
                ) : (
                  filteredGroups.map((g) => {
                    const on = selectedGroups.has(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() =>
                          setSelectedGroups((prev) => {
                            const next = new Set(prev);
                            if (on) next.delete(g.id);
                            else next.add(g.id);
                            return next;
                          })
                        }
                        className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-surface-sunken"
                      >
                        <span className="text-text-primary">{g.name}</span>
                        <span className={cn("flex h-5 w-5 items-center justify-center rounded-md border", on ? "border-brand bg-brand text-brand-foreground" : "border-border-strong")}>
                          {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              {scopeNeedsGroups && selectedGroups.size === 0 ? (
                <p className="mt-2 text-xs text-warning">اختر مجموعة واحدة على الأقل.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Permission categories */}
      <div className="flex flex-col gap-3">
        {EDITABLE_CATEGORIES.map((cat) => {
          const total = cat.permissions.length;
          const on = cat.permissions.filter((p) => enabled.has(p.key)).length;
          const isOpen = open.has(cat.key);
          return (
            <div key={cat.key} className="overflow-hidden rounded-xl border border-border bg-surface">
              <button
                type="button"
                onClick={() => setOpen((prev) => { const n = new Set(prev); if (isOpen) n.delete(cat.key); else n.add(cat.key); return n; })}
                aria-expanded={isOpen}
                className="focus-ring flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-surface-sunken/50"
              >
                <span className="flex items-center gap-2 font-medium text-text-primary">
                  {cat.label}
                  <span className={cn("text-xs font-semibold tabular-nums", on > 0 ? "text-brand" : "text-text-tertiary")}>
                    {new Intl.NumberFormat("ar-EG").format(on)}/{new Intl.NumberFormat("ar-EG").format(total)}
                  </span>
                </span>
                <ChevronDown className={cn("h-4 w-4 text-text-tertiary transition-transform", isOpen ? "rotate-180" : "")} aria-hidden />
              </button>
              {isOpen ? (
                <div className="flex flex-col divide-y divide-border border-t border-border">
                  {cat.permissions.map((p) => {
                    const isOn = enabled.has(p.key);
                    const risky = RISKY_PERMISSIONS.has(p.key);
                    return (
                      <label key={p.key} className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1.5 text-sm text-text-primary">
                            {p.label}
                            {isGroupScoped(p.key) ? null : <Badge tone="neutral" className="text-[10px]">عام</Badge>}
                          </span>
                          {risky && isOn ? (
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-warning">
                              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                              هذه الصلاحية تمنح وصولًا إداريًا واسعًا.
                            </span>
                          ) : null}
                        </span>
                        <Switch checked={isOn} onCheckedChange={(v) => toggle(p.key, v)} aria-label={p.label} />
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={scopeNeedsGroups && grantsUseGroupScope && selectedGroups.size === 0}
        >
          حفظ الصلاحيات
        </Button>
      </div>
    </div>
  );
}
