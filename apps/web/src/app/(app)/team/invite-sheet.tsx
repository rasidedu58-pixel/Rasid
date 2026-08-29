"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Link2, MessageCircle, Search, ShieldAlert } from "lucide-react";
import {
  PERMISSION_SCOPE_KIND,
  OWNER_ONLY_PERMISSION_KEYS,
  closurePermissionKeys,
  type DesiredGrant,
  type PermissionKey,
} from "@academic-precision/contracts";
import {
  Badge,
  Button,
  Field,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Switch,
  cn,
  toast,
} from "@academic-precision/ui";
import { qk } from "../../../lib/query-keys";
import { createInvitation } from "../../../lib/api/invitations";
import { PERMISSION_CATEGORIES, RISKY_PERMISSIONS, ROLE_PRESETS } from "./permission-catalog-ui";

interface Group {
  id: string;
  name: string;
}

function isGroupScoped(key: PermissionKey) {
  return PERMISSION_SCOPE_KIND[key] === "GROUP";
}

/** Same as the editor: the owner-only `team.manage` is never invitable. */
const EDITABLE_CATEGORIES = PERMISSION_CATEGORIES.map((c) => ({
  ...c,
  permissions: c.permissions.filter((p) => !OWNER_ONLY_PERMISSION_KEYS.has(p.key)),
})).filter((c) => c.permissions.length > 0);

const EXPIRY_OPTIONS = [
  { days: 1, label: "يوم واحد" },
  { days: 3, label: "3 أيام" },
  { days: 7, label: "7 أيام" },
  { days: 14, label: "14 يومًا" },
  { days: 30, label: "30 يومًا" },
];

const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

export function InviteSheet({
  open,
  onOpenChange,
  workspaceId,
  groups,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  groups: Group[];
}) {
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("");
  const [enabled, setEnabled] = useState<Set<PermissionKey>>(new Set());
  const [scope, setScope] = useState<"ALL_GROUPS" | "SELECTED_GROUPS">("ALL_GROUPS");
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set(EDITABLE_CATEGORIES.map((c) => c.key)));
  const [groupQuery, setGroupQuery] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const grantsUseGroupScope = [...enabled].some(isGroupScoped);
  const scopeNeedsGroups = scope === "SELECTED_GROUPS";
  const filteredGroups = groups.filter((g) => g.name.includes(groupQuery.trim()));
  const canSubmit = enabled.size > 0 && !(grantsUseGroupScope && scopeNeedsGroups && selectedGroups.size === 0);

  const create = useMutation({
    mutationFn: () => {
      const effective = new Set<PermissionKey>();
      for (const key of enabled) for (const dep of closurePermissionKeys(key)) effective.add(dep);
      const grants: DesiredGrant[] = [...effective].map((permission) => {
        if (isGroupScoped(permission) && scope === "SELECTED_GROUPS") {
          return { permission, scope: "SELECTED_GROUPS", groupIds: [...selectedGroups] };
        }
        return { permission, scope: "ALL_GROUPS" };
      });
      return createInvitation(workspaceId, {
        grants,
        expiresInDays,
        invitedLabel: label.trim() || undefined,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: qk.team.invitations(workspaceId) });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setCreatedLink(`${origin}/invite/${res.token}`);
    },
    onError: () => toast.error("تعذّر إنشاء رابط الدعوة"),
  });

  function toggle(key: PermissionKey, on: boolean) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (on) for (const dep of closurePermissionKeys(key)) next.add(dep);
      else next.delete(key);
      return next;
    });
  }

  function applyPreset(keys: PermissionKey[]) {
    const next = new Set<PermissionKey>();
    for (const key of keys) for (const dep of closurePermissionKeys(key)) next.add(dep);
    setEnabled(next);
  }

  function resetAll() {
    setLabel("");
    setEnabled(new Set());
    setScope("ALL_GROUPS");
    setSelectedGroups(new Set());
    setExpiresInDays(7);
    setCreatedLink(null);
    setCopied(false);
    create.reset();
  }

  function handleOpenChange(v: boolean) {
    if (!v) resetAll();
    onOpenChange(v);
  }

  async function copyLink() {
    if (!createdLink) return;
    try {
      await navigator.clipboard.writeText(createdLink);
      setCopied(true);
      toast.success("تم نسخ الرابط");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("تعذّر النسخ — انسخ الرابط يدويًا");
    }
  }

  const expiryLabel = useMemo(
    () => EXPIRY_OPTIONS.find((o) => o.days === expiresInDays)?.label ?? `${arNum(expiresInDays)} يومًا`,
    [expiresInDays],
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="end" className="flex w-full max-w-md flex-col">
        <SheetHeader>
          <SheetTitle>{createdLink ? "الرابط جاهز" : "دعوة عضو جديد"}</SheetTitle>
          <p className="mt-0.5 text-sm text-text-secondary">
            {createdLink
              ? "شارك هذا الرابط مع الشخص الذي تريد دعوته. لن نعرضه مجددًا."
              : "حدّد ما يستطيع الوصول إليه، ثم أنشئ رابطًا يشاركه للانضمام."}
          </p>
        </SheetHeader>

        {createdLink ? (
          <LinkReady
            link={createdLink}
            copied={copied}
            onCopy={copyLink}
            expiryLabel={expiryLabel}
            onNewLink={resetAll}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          <div className="mt-5 flex flex-1 flex-col gap-6 overflow-y-auto pb-4">
            {/* Optional label */}
            <Field label="لمن هذه الدعوة؟ (اختياري)" htmlFor="invite-label">
              <Input
                id="invite-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="مثال: أ. محمد — مساعد متابعة"
                maxLength={120}
              />
            </Field>

            {/* Presets */}
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

            {/* Group scope */}
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
                        scope === s
                          ? "border-brand bg-brand-subtle/50 font-medium text-brand-subtle-foreground"
                          : "border-border text-text-secondary hover:bg-surface-sunken",
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
                              <span
                                className={cn(
                                  "flex h-5 w-5 items-center justify-center rounded-md border",
                                  on ? "border-brand bg-brand text-brand-foreground" : "border-border-strong",
                                )}
                              >
                                {on ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {selectedGroups.size === 0 ? (
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
                const isOpen = openCats.has(cat.key);
                return (
                  <div key={cat.key} className="overflow-hidden rounded-xl border border-border bg-surface">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenCats((prev) => {
                          const n = new Set(prev);
                          if (isOpen) n.delete(cat.key);
                          else n.add(cat.key);
                          return n;
                        })
                      }
                      aria-expanded={isOpen}
                      className="focus-ring flex w-full items-center justify-between gap-3 px-4 py-3 text-start hover:bg-surface-sunken/50"
                    >
                      <span className="flex items-center gap-2 font-medium text-text-primary">
                        {cat.label}
                        <span className={cn("text-xs font-semibold tabular-nums", on > 0 ? "text-brand" : "text-text-tertiary")}>
                          {arNum(on)}/{arNum(total)}
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
                                  {isGroupScoped(p.key) ? null : (
                                    <Badge tone="neutral" className="text-[10px]">
                                      عام
                                    </Badge>
                                  )}
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

            {/* Expiry */}
            <div>
              <p className="mb-2 text-sm font-semibold text-text-primary">مدة صلاحية الرابط</p>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_OPTIONS.map((o) => (
                  <button
                    key={o.days}
                    type="button"
                    onClick={() => setExpiresInDays(o.days)}
                    className={cn(
                      "focus-ring rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      expiresInDays === o.days
                        ? "border-brand bg-brand-subtle/50 font-medium text-brand-subtle-foreground"
                        : "border-border text-text-secondary hover:bg-surface-sunken",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!createdLink ? (
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>
              إلغاء
            </Button>
            <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!canSubmit}>
              <Link2 className="h-4 w-4" aria-hidden />
              إنشاء رابط الدعوة
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function LinkReady({
  link,
  copied,
  onCopy,
  expiryLabel,
  onNewLink,
  onDone,
}: {
  link: string;
  copied: boolean;
  onCopy: () => void;
  expiryLabel: string;
  onNewLink: () => void;
  onDone: () => void;
}) {
  return (
    <div className="mt-5 flex flex-1 flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <label className="text-xs font-semibold text-text-secondary" htmlFor="invite-link">
          رابط الدعوة
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="invite-link"
            readOnly
            value={link}
            dir="ltr"
            onFocus={(e) => e.currentTarget.select()}
            className="focus-ring h-10 flex-1 rounded-lg border border-border bg-surface-sunken px-3 text-sm text-text-primary"
          />
          <Button onClick={onCopy} className="shrink-0">
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied ? "تم النسخ" : "نسخ"}
          </Button>
        </div>
      </div>

      <button
        type="button"
        disabled
        title="ستتوفر المشاركة عبر واتساب قريبًا"
        className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-tertiary opacity-60"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        مشاركة عبر واتساب
        <Badge tone="neutral" className="text-[10px]">
          قريبًا
        </Badge>
      </button>

      <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5 text-xs text-text-secondary">
        الرابط صالح لمرة واحدة فقط وينتهي بعد {expiryLabel}. العضوية لا تُفعّل إلا بعد قبول الدعوة، ويمكنك إلغاؤها في أي وقت من قائمة الدعوات.
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onNewLink}>
          إنشاء رابط آخر
        </Button>
        <Button onClick={onDone}>تم</Button>
      </div>
    </div>
  );
}
