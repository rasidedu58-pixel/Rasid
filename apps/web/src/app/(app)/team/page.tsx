"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, ShieldCheck, User } from "lucide-react";
import { Button, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, StatusDot, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, cn, toast, useConfirmDialog } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { disableMembership, fetchTeam } from "../../../lib/api/team";

const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = { ACTIVE: "success", INVITED: "neutral", DISABLED: "danger" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "نشط", INVITED: "مدعو", DISABLED: "معطّل" };

/**
 * Team & Permissions (§27) — read-only member list + disable action.
 * Granular per-permission grant EDITING is intentionally not built here:
 * `GET /team` (Phase 2) never returns a member's current effective grants,
 * only `PATCH /memberships/:id/permissions`'s own response does — so a
 * pre-filled editor cannot be built safely without guessing prior state.
 * Documented as a known Phase 11 limitation, not silently faked.
 */
export default function TeamPage() {
  const { workspaceId, isOwner } = useWorkspace();
  const queryClient = useQueryClient();
  const [disabling, setDisabling] = useState<string | null>(null);
  const confirm = useConfirmDialog();

  const query = useQuery({
    queryKey: workspaceId ? qk.team.list(workspaceId) : ["team", "none"],
    queryFn: () => fetchTeam(workspaceId!),
    enabled: !!workspaceId,
  });

  const disableMutation = useMutation({
    mutationFn: (membershipId: string) => disableMembership(workspaceId!, membershipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.team.list(workspaceId!) });
      toast.success("تم تعطيل العضوية");
      confirm.closeDialog();
    },
    onError: () => toast.error("تعذّر تعطيل العضوية"),
  });

  return (
    <>
      <PageHeader title="الفريق والصلاحيات" description="أعضاء مساحة العمل وأدوارهم. مالك المساحة محميّ ولا يمكن تعطيله." />

      {query.isLoading ? (
        <SkeletonRows rows={4} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.members.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا يوجد أعضاء فريق بعد" />
      ) : (
        <TableScroll>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العضو</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end" aria-label="إجراء" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data!.members.map((m) => {
                const owner = m.roleLabel === "OWNER";
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", owner ? "bg-brand-subtle text-brand" : "bg-surface-sunken text-text-secondary")} aria-hidden>
                          {owner ? <Crown className="h-4 w-4" /> : <User className="h-4 w-4" />}
                        </span>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-text-primary">{owner ? "مالك مساحة العمل" : m.roleLabel === "ASSISTANT" ? "مساعد" : m.roleLabel}</span>
                          {owner ? <span className="text-xs text-text-tertiary">صلاحيات كاملة · محميّ</span> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusDot tone={STATUS_TONE[m.status] ?? "neutral"} label={STATUS_LABEL[m.status] ?? m.status} />
                    </TableCell>
                    <TableCell className="text-end">
                      {isOwner && !owner && m.status !== "DISABLED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-danger hover:bg-danger-subtle hover:text-danger"
                          onClick={() => {
                            setDisabling(m.id);
                            confirm.openDialog();
                          }}
                        >
                          تعطيل
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      )}

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.setOpen}
        title="تعطيل عضوية الفريق"
        description="لن يتمكن هذا العضو من الوصول إلى مساحة العمل بعد التعطيل."
        destructive
        loading={disableMutation.isPending}
        onConfirm={() => {
          if (disabling) disableMutation.mutate(disabling);
        }}
      />
    </>
  );
}
