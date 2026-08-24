"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CardContent, ErrorState, LoadingRegion, PermissionDeniedState, SectionCard, formatDate } from "@academic-precision/ui";
import { PageHeader } from "../../../../components/shell/page-header";
import { qk } from "../../../../lib/query-keys";
import { fetchPlatformAdminUser } from "../../../../lib/api/platform-admin";
import { isForbidden } from "../../../../lib/api/client";

export default function PlatformAdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const query = useQuery({
    queryKey: qk.platformAdmin.user(userId),
    queryFn: () => fetchPlatformAdminUser(userId),
    retry: (failureCount, error) => !isForbidden(error) && failureCount < 2,
  });

  if (query.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (isForbidden(query.error)) return <PermissionDeniedState />;
  if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;

  const user = query.data;

  return (
    <>
      <PageHeader
        title={user.fullName}
        actions={<Badge tone={user.status === "ACTIVE" ? "success" : "neutral"}>{user.status === "ACTIVE" ? "نشط" : user.status}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-text-secondary">البريد الإلكتروني</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{user.emailDisplay ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-secondary">الهاتف</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{user.phone ?? "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-secondary">تاريخ التسجيل</p>
          <p className="mt-1 text-sm font-medium text-text-primary">{formatDate(user.createdAt)}</p>
        </Card>
      </div>

      <SectionCard title={`مساحات العمل (${user.memberships.length})`} className="mt-4">
        {user.memberships.length === 0 ? (
          <p className="text-sm text-text-secondary">لا ينتمي لأي مساحة عمل.</p>
        ) : (
          <CardContent className="flex flex-col divide-y divide-border p-0">
            {user.memberships.map((m) => (
              <Link key={m.workspaceId} href={`/platform-admin/workspaces/${m.workspaceId}`} className="flex items-center justify-between py-2.5 hover:text-brand">
                <span className="text-sm text-text-primary">{m.workspaceName}</span>
                <span className="flex items-center gap-2 text-xs text-text-tertiary">
                  {m.roleLabel}
                  <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status}</Badge>
                </span>
              </Link>
            ))}
          </CardContent>
        )}
      </SectionCard>
    </>
  );
}
