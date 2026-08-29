"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Link2, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  ConfirmDialog,
  StatusDot,
  formatDateTime,
  toast,
  useConfirmDialog,
} from "@academic-precision/ui";
import type { InvitationSummary } from "@academic-precision/contracts";
import { qk } from "../../../lib/query-keys";
import { listInvitations, revokeInvitation } from "../../../lib/api/invitations";

const arNum = (n: number) => new Intl.NumberFormat("ar-EG").format(n);

/**
 * Pending-invitations panel on the team page. Only PENDING invites are shown
 * (accepted/revoked live in the audit trail); an expired-but-still-PENDING
 * invite is rendered distinctly and can still be revoked to tidy up.
 */
export function InvitationsList({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const confirm = useConfirmDialog();
  const [targetId, setTargetId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: qk.team.invitations(workspaceId),
    queryFn: () => listInvitations(workspaceId),
    enabled: !!workspaceId,
  });

  const pending = (query.data?.invitations ?? []).filter((i) => i.status === "PENDING");

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(workspaceId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.team.invitations(workspaceId) });
      toast.success("تم إلغاء الدعوة");
      confirm.closeDialog();
    },
    onError: () => toast.error("تعذّر إلغاء الدعوة"),
  });

  if (pending.length === 0) return null;

  return (
    <section className="mt-6 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-brand" aria-hidden />
        <h2 className="text-sm font-semibold text-text-primary">دعوات معلقة</h2>
        <Badge tone="neutral">{arNum(pending.length)}</Badge>
      </div>

      <ul className="flex flex-col gap-2">
        {pending.map((inv) => (
          <InvitationRow
            key={inv.id}
            inv={inv}
            onRevoke={() => {
              setTargetId(inv.id);
              confirm.openDialog();
            }}
          />
        ))}
      </ul>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.setOpen}
        title="إلغاء الدعوة"
        description="لن يعمل رابط هذه الدعوة بعد الآن. يمكنك إنشاء رابط جديد في أي وقت."
        destructive
        loading={revoke.isPending}
        onConfirm={() => {
          if (targetId) revoke.mutate(targetId);
        }}
      />
    </section>
  );
}

function InvitationRow({ inv, onRevoke }: { inv: InvitationSummary; onRevoke: () => void }) {
  const capabilities = inv.grants.length;
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-subtle/50">
        <Link2 className="h-4 w-4 text-brand" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-text-primary">{inv.invitedLabel ?? "رابط دعوة"}</span>
        <span className="flex items-center gap-1.5 truncate text-xs text-text-secondary">
          <Clock className="h-3 w-3" aria-hidden />
          {inv.expired ? "انتهت الصلاحية" : `تنتهي ${formatDateTime(inv.expiresAt)}`}
          {" · "}
          {arNum(capabilities)} صلاحية
        </span>
      </div>
      <div className="hidden shrink-0 sm:block">
        <StatusDot tone={inv.expired ? "danger" : "neutral"} label={inv.expired ? "منتهية" : "بانتظار القبول"} />
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-danger hover:bg-danger-subtle hover:text-danger"
        onClick={onRevoke}
        aria-label="إلغاء الدعوة"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        إلغاء
      </Button>
    </li>
  );
}
