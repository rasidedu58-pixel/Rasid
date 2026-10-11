"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Eye, EyeOff, Link2, MessageCircle, Search, ShieldAlert } from "lucide-react";
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
import { createTeamMember } from "../../../lib/api/invitations";
import { ApiRequestError, isValidationError } from "../../../lib/api/client";
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

const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

/** What the owner hands over after creating the member. */
interface Handover {
  link: string;
  email: string;
  password: string;
  /** EXISTING = the email already had an account, so its password was NOT changed. */
  account: "CREATED" | "EXISTING";
}

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

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [enabled, setEnabled] = useState<Set<PermissionKey>>(new Set());
  const [scope, setScope] = useState<"ALL_GROUPS" | "SELECTED_GROUPS">("ALL_GROUPS");
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set(EDITABLE_CATEGORIES.map((c) => c.key)));
  const [groupQuery, setGroupQuery] = useState("");
  const [handover, setHandover] = useState<Handover | null>(null);
  const [copied, setCopied] = useState<"link" | "all" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const grantsUseGroupScope = [...enabled].some(isGroupScoped);
  const scopeNeedsGroups = scope === "SELECTED_GROUPS";
  const filteredGroups = groups.filter((g) => g.name.includes(groupQuery.trim()));
  const credentialsReady = fullName.trim().length > 0 && /.+@.+\..+/.test(email.trim()) && password.length >= 8;
  const canSubmit =
    credentialsReady && enabled.size > 0 && !(grantsUseGroupScope && scopeNeedsGroups && selectedGroups.size === 0);

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
      return createTeamMember(workspaceId, {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
        grants,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: qk.team.invitations(workspaceId) });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      setFormError(null);
      setFieldErrors({});
      // The password is shown back from the OWNER'S OWN input, never from the
      // server — no response carries it, and nothing stored it.
      setHandover({ link: `${origin}/invite/${res.token}`, email: res.email, password, account: res.account });
    },
    onError: (e: unknown) => {
      if (e instanceof ApiRequestError && isValidationError(e)) {
        const errors = e.fieldErrors ?? {};
        setFieldErrors(errors);
        setFormError(errors._root?.[0] ?? null);
        if (!errors._root) toast.error("راجع الحقول");
        return;
      }
      toast.error("تعذّر إنشاء العضو");
    },
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
    setFullName("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setEnabled(new Set());
    setScope("ALL_GROUPS");
    setSelectedGroups(new Set());
    setHandover(null);
    setCopied(null);
    setFormError(null);
    setFieldErrors({});
    create.reset();
  }

  function handleOpenChange(v: boolean) {
    if (!v) resetAll();
    onOpenChange(v);
  }

  async function copy(what: "link" | "all") {
    if (!handover) return;
    const text = what === "link" ? handover.link : handoverMessage(handover);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      toast.success(what === "link" ? "تم نسخ الرابط" : "تم نسخ بيانات الدخول");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("تعذّر النسخ — انسخ يدويًا");
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="end" className="flex w-full max-w-md flex-col">
        <SheetHeader>
          <SheetTitle>{handover ? "بيانات العضو جاهزة" : "إضافة عضو للفريق"}</SheetTitle>
          <p className="mt-0.5 text-sm text-text-secondary">
            {handover
              ? "سلّم هذه البيانات للعضو. كلمة المرور لن تظهر مرة أخرى بعد إغلاق هذه النافذة."
              : "أنشئ بيانات دخوله وحدّد صلاحياته، ثم سلّمه الرابط والبريد وكلمة المرور."}
          </p>
        </SheetHeader>

        {handover ? (
          <HandoverPanel
            handover={handover}
            copied={copied}
            onCopy={copy}
            onAnother={resetAll}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          <div className="mt-5 flex flex-1 flex-col gap-6 overflow-y-auto pb-4">
            {/* Sign-in credentials — the owner decides them, so the member
                never has to go and register themselves. */}
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-semibold text-text-primary">بيانات الدخول</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  أنت من يحدّدها، وتسلّمها للعضو. لا يحفظ راصد كلمة المرور ولا يمكنه عرضها لاحقًا.
                </p>
              </div>
              <Field label="اسم العضو" htmlFor="member-name" required error={fieldErrors.fullName?.[0]}>
                <Input
                  id="member-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="مثال: أ. محمد سعيد"
                  maxLength={120}
                  invalid={!!fieldErrors.fullName}
                />
              </Field>
              <Field label="البريد الإلكتروني" htmlFor="member-email" required error={fieldErrors.email?.[0]}>
                <Input
                  id="member-email"
                  type="email"
                  dir="ltr"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="assistant@example.com"
                  invalid={!!fieldErrors.email}
                />
              </Field>
              <Field
                label="كلمة المرور"
                htmlFor="member-password"
                required
                hint="8 أحرف على الأقل — سلّمها للعضو بنفسك"
                error={fieldErrors.password?.[0]}
              >
                <div className="flex gap-2">
                  <Input
                    id="member-password"
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    invalid={!!fieldErrors.password}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </Button>
                </div>
              </Field>
            </div>

            {formError ? (
              <p className="rounded-lg border border-danger/30 bg-danger-subtle/20 px-3 py-2.5 text-sm leading-relaxed text-danger">
                {formError}
              </p>
            ) : null}

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

          </div>
        )}

        {!handover ? (
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
            <Button variant="ghost" className="w-full justify-center sm:w-auto" onClick={() => handleOpenChange(false)}>
              إلغاء
            </Button>
            <Button className="w-full justify-center sm:w-auto" onClick={() => create.mutate()} loading={create.isPending} disabled={!canSubmit}>
              <Link2 className="h-4 w-4" aria-hidden />
              إنشاء العضو
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The one message the owner sends: link + email + password, ready to paste. */
function handoverMessage(h: Handover): string {
  return [
    "دعوة للانضمام إلى فريق راصد:",
    h.link,
    `البريد: ${h.email}`,
    h.account === "CREATED" ? `كلمة المرور: ${h.password}` : "استخدم كلمة المرور الخاصة بحسابك الحالي.",
  ].join("\n");
}

/**
 * What the owner hands over. Everything here is laid out to survive a 360px
 * screen: the link is a wrapping, selectable block rather than a one-line
 * input that scrolls sideways, and every action is full-width below `sm`.
 */
function HandoverPanel({
  handover,
  copied,
  onCopy,
  onAnother,
  onDone,
}: {
  handover: Handover;
  copied: "link" | "all" | null;
  onCopy: (what: "link" | "all") => void;
  onAnother: () => void;
  onDone: () => void;
}) {
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(handoverMessage(handover))}`;
  return (
    <div className="mt-5 flex flex-1 flex-col gap-4 overflow-y-auto">
      {handover.account === "EXISTING" ? (
        <p className="rounded-lg border border-warning/30 bg-warning-subtle/30 px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
          هذا البريد له حساب بالفعل، فلم يُنشأ حساب جديد ولم تتغيّر كلمة مروره. أرسل له الرابط فقط — سيدخل بكلمة المرور التي يعرفها.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-text-secondary">رابط الدعوة</span>
          {/* `break-all` + wrapping block: a 60-character token in a
              single-line input is unreadable and overflows on a phone. */}
          <p dir="ltr" className="select-all break-all rounded-lg bg-surface-sunken px-3 py-2 text-start text-xs leading-relaxed text-text-primary">
            {handover.link}
          </p>
          <Button variant="outline" className="mt-1 w-full justify-center" onClick={() => onCopy("link")}>
            {copied === "link" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied === "link" ? "تم نسخ الرابط" : "نسخ الرابط"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-2 border-t border-border pt-3 sm:grid-cols-2">
          <div className="min-w-0">
            <span className="text-xs text-text-tertiary">البريد الإلكتروني</span>
            <p dir="ltr" className="select-all break-all text-start text-sm text-text-primary">{handover.email}</p>
          </div>
          <div className="min-w-0">
            <span className="text-xs text-text-tertiary">كلمة المرور</span>
            <p dir="ltr" className="select-all break-all text-start text-sm text-text-primary">
              {handover.account === "CREATED" ? handover.password : "— (حسابه الحالي)"}
            </p>
          </div>
        </div>
      </div>

      <Button variant="outline" className="w-full justify-center" onClick={() => onCopy("all")}>
        {copied === "all" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied === "all" ? "تم نسخ البيانات" : "نسخ الرابط والبيانات معًا"}
      </Button>

      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-sunken"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        مشاركة عبر واتساب
      </a>

      <div className="rounded-lg border border-border bg-surface-sunken px-3 py-2.5 text-xs leading-relaxed text-text-secondary">
        الرابط يعمل مرة واحدة ولا ينتهي بمرور الوقت — يظل صالحًا حتى يقبله العضو أو تلغيه أنت من قائمة الدعوات. بعد القبول تصبح عضويته مستقلة عن الرابط تمامًا، ويدخل بعدها من صفحة تسجيل الدخول العادية.
      </div>

      <div className="mt-auto flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" className="w-full justify-center sm:w-auto" onClick={onAnother}>
          إضافة عضو آخر
        </Button>
        <Button className="w-full justify-center sm:w-auto" onClick={onDone}>تم</Button>
      </div>
    </div>
  );
}
