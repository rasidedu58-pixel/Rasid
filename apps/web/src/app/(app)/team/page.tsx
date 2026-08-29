"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crown, UserPlus, ShieldCheck, ChevronLeft, Users } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  Button,
  EmptyState,
  ErrorState,
  MetricStrip,
  MetricCell,
  SkeletonRows,
  StatusDot,
  initialsFromName,
} from "@academic-precision/ui";
import type { TeamMember } from "@academic-precision/contracts";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchTeam } from "../../../lib/api/team";
import { fetchGroups } from "../../../lib/api/scheduling";
import { MemberDrawer, deriveRoleLabel } from "./member-drawer";
import { InviteSheet } from "./invite-sheet";
import { InvitationsList } from "./invitations-list";

const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = { ACTIVE: "success", INVITED: "neutral", DISABLED: "danger" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "نشط", INVITED: "دعوة معلقة", DISABLED: "موقوف" };
const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

export default function TeamPage() {
  const { workspaceId, hasPermission } = useWorkspace();
  const ws = workspaceId ?? "";
  const canManage = hasPermission("team.manage");
  const canGroups = hasPermission("groups.view");

  const [selected, setSelected] = useState<TeamMember | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INVITED" | "DISABLED">("ALL");

  const query = useQuery({
    queryKey: workspaceId ? qk.team.list(ws) : ["team", "none"],
    queryFn: () => fetchTeam(ws),
    enabled: !!workspaceId,
  });

  const groupsQuery = useQuery({
    queryKey: qk.groups.list(ws),
    queryFn: () => fetchGroups(ws),
    enabled: !!workspaceId && canGroups && canManage,
  });
  const groups = groupsQuery.data?.groups ?? [];

  const members = query.data?.members ?? [];
  const summary = useMemo(() => {
    const active = members.filter((m) => m.status === "ACTIVE").length;
    const invited = members.filter((m) => m.status === "INVITED").length;
    const disabled = members.filter((m) => m.status === "DISABLED").length;
    const roles = new Set(members.map((m) => deriveRoleLabel(m)));
    return { active, invited, disabled, roles: roles.size };
  }, [members]);

  const filtered = useMemo(() => {
    const term = q.trim();
    return members.filter((m) => {
      if (statusFilter !== "ALL" && m.status !== statusFilter) return false;
      if (!term) return true;
      return `${m.fullName ?? ""} ${m.email ?? ""} ${deriveRoleLabel(m)}`.includes(term);
    });
  }, [members, q, statusFilter]);

  const onlySelf = members.length <= 1;

  function openMember(m: TeamMember) {
    setSelected(m);
    setDrawerOpen(true);
  }

  return (
    <>
      <PageHeader
        title="الفريق"
        description="أدر أعضاء مساحة العمل وحدد ما يمكن لكل شخص الوصول إليه."
        actions={
          canManage ? (
            <Button onClick={() => setInviteOpen(true)}>
              <UserPlus className="h-4 w-4" aria-hidden />
              إضافة عضو
            </Button>
          ) : undefined
        }
      />

      {query.isLoading ? (
        <div className="flex flex-col gap-4">
          <SkeletonRows rows={4} />
        </div>
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : onlySelf ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8 text-brand" aria-hidden />}
          title="تعمل وحدك حاليًا"
          description="يمكنك إضافة مساعد أو عضو فريق وتحديد ما يستطيع الوصول إليه بدقة."
          action={
            canManage ? (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-4 w-4" aria-hidden />
                إضافة عضو
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* Compact summary — not giant KPI cards */}
          <MetricStrip columns={4}>
            <MetricCell label="أعضاء نشطون" value={arNum(summary.active)} />
            <MetricCell label="دعوات معلقة" value={arNum(summary.invited)} />
            <MetricCell label="موقوفون" value={arNum(summary.disabled)} tone={summary.disabled > 0 ? "warning" : "default"} />
            <MetricCell label="الأدوار المستخدمة" value={arNum(summary.roles)} />
          </MetricStrip>

          {/* Search + status filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Users className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ابحث بالاسم أو البريد…"
                aria-label="ابحث في الفريق"
                className="focus-ring h-10 w-full rounded-lg border border-border bg-surface pe-10 ps-3 text-sm text-text-primary placeholder:text-text-tertiary"
              />
            </div>
            <div className="flex gap-1.5">
              {(["ALL", "ACTIVE", "INVITED", "DISABLED"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`focus-ring rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    statusFilter === s ? "border-brand bg-brand-subtle/50 text-brand-subtle-foreground" : "border-border text-text-secondary hover:bg-surface-sunken"
                  }`}
                >
                  {s === "ALL" ? "الكل" : STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Member rows — responsive (cards on mobile, aligned rows on desktop) */}
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-text-secondary">لا يوجد أعضاء مطابقون.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {filtered.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => openMember(m)}
                    className="focus-ring flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 text-start transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-sm"
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      <AvatarFallback>{m.isOwner ? <Crown className="h-4 w-4 text-brand" aria-hidden /> : initialsFromName(m.fullName ?? "؟")}</AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-text-primary">{m.fullName ?? "عضو"}</span>
                      <span className="truncate text-xs text-text-secondary">{deriveRoleLabel(m)}{m.email ? ` · ${m.email}` : ""}</span>
                    </div>
                    <div className="hidden shrink-0 sm:block">
                      <StatusDot tone={STATUS_TONE[m.status] ?? "neutral"} label={STATUS_LABEL[m.status] ?? m.status} />
                    </div>
                    <ChevronLeft className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canManage && !query.isLoading && !query.isError ? <InvitationsList workspaceId={ws} /> : null}

      <MemberDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        member={selected}
        groups={groups}
        workspaceId={ws}
        canManage={canManage}
      />

      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} workspaceId={ws} groups={groups} />
    </>
  );
}
