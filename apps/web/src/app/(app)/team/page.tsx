"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableScroll, toast, useConfirmDialog } from "@academic-precision/ui";
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
      <PageHeader title="الفريق والصلاحيات" />

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
                <TableHead>الدور</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data!.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium text-text-primary">{m.roleLabel === "OWNER" ? "مالك مساحة العمل" : m.roleLabel}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONE[m.status] ?? "neutral"}>{STATUS_LABEL[m.status] ?? m.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {isOwner && m.roleLabel !== "OWNER" && m.status !== "DISABLED" ? (
                      <Button
                        size="sm"
                        variant="outline"
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
              ))}
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
