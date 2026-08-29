"use client";

import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Mail, Phone, CalendarDays, Layers, Clock } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ConfirmDialog,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateTime,
  initialsFromName,
  toast,
  useConfirmDialog,
} from "@academic-precision/ui";
import type { PermissionKey, TeamMember } from "@academic-precision/contracts";
import { closurePermissionKeys } from "@academic-precision/contracts";
import { qk } from "../../../lib/query-keys";
import { disableMembership, enableMembership } from "../../../lib/api/team";
import { PermissionEditor } from "./permission-editor";
import { PERMISSION_LABEL, ROLE_PRESETS } from "./permission-catalog-ui";

interface Group {
  id: string;
  name: string;
}

const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = { ACTIVE: "success", INVITED: "neutral", DISABLED: "danger" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "نشط", INVITED: "دعوة معلقة", DISABLED: "موقوف" };

/** Derives a friendly role label from a member's actual grants (matches a preset if it fits, else "مخصّص"). */
export function deriveRoleLabel(member: TeamMember): string {
  if (member.isOwner) return "مالك مساحة العمل";
  const set = new Set(member.grants.map((g) => g.permission));
  for (const preset of ROLE_PRESETS) {
    if (preset.key === "custom" || preset.permissions.length === 0) continue;
    const closure = new Set<PermissionKey>();
    for (const k of preset.permissions) for (const dep of closurePermissionKeys(k)) closure.add(dep);
    if (closure.size === set.size && [...closure].every((k) => set.has(k))) return preset.label;
  }
  return set.size === 0 ? "بلا صلاحيات" : "صلاحيات مخصّصة";
}

function memberScopeSummary(member: TeamMember, groups: Group[]): { all: boolean; names: string[] } {
  const anySelected = member.grants.some((g) => g.scope === "SELECTED_GROUPS");
  if (member.isOwner || !anySelected) return { all: true, names: [] };
  const ids = new Set<string>();
  for (const g of member.grants) if (g.scope === "SELECTED_GROUPS") (g.groupIds ?? []).forEach((id) => ids.add(id));
  const byId = new Map(groups.map((g) => [g.id, g.name]));
  return { all: false, names: [...ids].map((id) => byId.get(id) ?? id) };
}

export function MemberDrawer({
  open,
  onOpenChange,
  member,
  groups,
  workspaceId,
  canManage,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  member: TeamMember | null;
  groups: Group[];
  workspaceId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirmDialog();

  const disable = useMutation({
    mutationFn: () => disableMembership(workspaceId, member!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.team.list(workspaceId) });
      toast.success("تم إيقاف وصول العضو");
      confirm.closeDialog();
    },
    onError: () => toast.error("تعذّر إيقاف الوصول"),
  });
  const enable = useMutation({
    mutationFn: () => enableMembership(workspaceId, member!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.team.list(workspaceId) });
      toast.success("تمت إعادة تفعيل العضو");
    },
    onError: () => toast.error("تعذّر إعادة التفعيل"),
  });

  if (!member) return null;

  const role = deriveRoleLabel(member);
  const scope = memberScopeSummary(member, groups);
  const grantedPerms = member.grants.map((g) => g.permission);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="w-full max-w-md">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11">
              <AvatarFallback>{member.isOwner ? <Crown className="h-5 w-5 text-brand" aria-hidden /> : initialsFromName(member.fullName ?? "؟")}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <SheetTitle className="truncate">{member.fullName ?? "عضو"}</SheetTitle>
              <p className="mt-0.5 text-sm text-text-secondary">{role}</p>
            </div>
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="mt-5">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">نظرة عامة</TabsTrigger>
            {!member.isOwner && canManage ? <TabsTrigger value="access" className="flex-1">الصلاحيات</TabsTrigger> : null}
            <TabsTrigger value="groups" className="flex-1">المجموعات</TabsTrigger>
            <TabsTrigger value="activity" className="flex-1">النشاط</TabsTrigger>
          </TabsList>

          {/* Overview */}
          <TabsContent value="overview" className="mt-4 flex flex-col gap-3">
            <Row icon={<Crown className="h-4 w-4" aria-hidden />} label="الدور" value={role} />
            <Row icon={null} label="الحالة" value={<StatusDot tone={STATUS_TONE[member.status] ?? "neutral"} label={STATUS_LABEL[member.status] ?? member.status} />} />
            {member.email ? <Row icon={<Mail className="h-4 w-4" aria-hidden />} label="البريد" value={member.email} /> : null}
            {member.phone ? <Row icon={<Phone className="h-4 w-4" aria-hidden />} label="الهاتف" value={member.phone} /> : null}
            <Row icon={<CalendarDays className="h-4 w-4" aria-hidden />} label="تاريخ الانضمام" value={formatDateTime(member.joinedAt)} />

            {canManage && !member.isOwner ? (
              <div className="mt-3 border-t border-border pt-4">
                {member.status === "DISABLED" ? (
                  <Button variant="outline" loading={enable.isPending} onClick={() => enable.mutate()}>
                    إعادة تفعيل الوصول
                  </Button>
                ) : (
                  <Button variant="outline" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => confirm.openDialog()}>
                    إيقاف وصول العضو
                  </Button>
                )}
                <p className="mt-2 text-xs text-text-tertiary">الإيقاف يمنع الوصول ويُبقي كل سجلّات العضو التاريخية كما هي.</p>
              </div>
            ) : member.isOwner ? (
              <div className="mt-3 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-xs text-text-secondary">مالك المساحة محميّ ولا يمكن إيقافه أو تعديل صلاحياته.</div>
            ) : null}
          </TabsContent>

          {/* Access / permissions editor */}
          {!member.isOwner && canManage ? (
            <TabsContent value="access" className="mt-4">
              <PermissionEditor workspaceId={workspaceId} member={member} groups={groups} onSaved={() => onOpenChange(false)} />
            </TabsContent>
          ) : null}

          {/* Groups */}
          <TabsContent value="groups" className="mt-4">
            {member.isOwner || scope.all ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-primary">
                <Layers className="h-4 w-4 text-brand" aria-hidden />
                كل المجموعات
              </div>
            ) : scope.names.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {scope.names.map((n) => (
                  <li key={n} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-primary">
                    <Layers className="h-4 w-4 text-brand" aria-hidden />
                    {n}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-text-secondary">لا توجد مجموعات ضمن نطاقه بعد.</p>
            )}

            {grantedPerms.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">ما يستطيع فعله</p>
                <div className="flex flex-wrap gap-1.5">
                  {grantedPerms.map((p) => (
                    <Badge key={p} tone="brand">{PERMISSION_LABEL[p] ?? p}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </TabsContent>

          {/* Activity (Phase 3) */}
          <TabsContent value="activity" className="mt-4">
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
              <Clock className="h-6 w-6 text-text-tertiary" aria-hidden />
              <p className="text-sm text-text-secondary">سجل نشاط العضو سيتوفر قريبًا.</p>
            </div>
          </TabsContent>
        </Tabs>

        <ConfirmDialog
          open={confirm.open}
          onOpenChange={confirm.setOpen}
          title="إيقاف وصول العضو"
          description="لن يتمكن هذا العضو من الوصول إلى مساحة العمل. تبقى كل سجلّاته كما هي، ويمكنك إعادة تفعيله لاحقًا."
          destructive
          loading={disable.isPending}
          onConfirm={() => disable.mutate()}
        />
      </SheetContent>
    </Sheet>
  );
}

function Row({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
      <span className="flex items-center gap-2 text-sm text-text-secondary">
        {icon ? <span className="text-text-tertiary">{icon}</span> : null}
        {label}
      </span>
      <span className="text-sm font-medium text-text-primary">{value}</span>
    </div>
  );
}
