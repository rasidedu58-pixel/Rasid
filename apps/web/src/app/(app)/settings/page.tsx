"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Avatar, AvatarFallback, SectionCard, Tabs, TabsContent, TabsList, TabsTrigger, initialsFromName } from "@academic-precision/ui";
import { PageHeader } from "../../../components/shell/page-header";
import { useSession } from "../../../lib/session-provider";
import { useWorkspace } from "../../../lib/workspace-provider";
import { BillingTab } from "./billing-tab";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsContent />
    </Suspense>
  );
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const { session } = useSession();
  const { workspaceName, timezone, roleLabel } = useWorkspace();
  const defaultTab = searchParams.get("tab") === "billing" ? "billing" : "account";

  return (
    <>
      <PageHeader title="الإعدادات" />
      <Tabs defaultValue={defaultTab} dir="rtl">
        <TabsList>
          <TabsTrigger value="account">الحساب</TabsTrigger>
          <TabsTrigger value="workspace">مساحة العمل</TabsTrigger>
          <TabsTrigger value="billing">الاشتراك</TabsTrigger>
        </TabsList>

        <TabsContent value="account">
          <SectionCard title="بيانات الحساب">
            <div className="flex items-center gap-4 border-b border-border pb-4">
              <Avatar className="h-12 w-12">
                <AvatarFallback>{initialsFromName(session?.user.email ?? "")}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-text-primary" dir="ltr">{session?.user.email ?? "—"}</span>
                <span className="text-xs text-text-tertiary">{roleLabel === "OWNER" ? "مالك مساحة العمل" : roleLabel ?? "—"}</span>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <Row label="البريد الإلكتروني" value={session?.user.email ?? "—"} />
              <Row label="الدور" value={roleLabel === "OWNER" ? "مالك مساحة العمل" : roleLabel ?? "—"} />
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="workspace">
          <SectionCard title="بيانات مساحة العمل">
            <div className="flex flex-col gap-2 text-sm">
              <Row label="الاسم" value={workspaceName ?? "—"} />
              <Row label="المنطقة الزمنية" value={timezone ?? "—"} />
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="billing">
          <BillingTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 last:border-0">
      <span className="text-text-secondary">{label}</span>
      <span className="font-medium text-text-primary" dir={value.includes("@") ? "ltr" : undefined}>
        {value}
      </span>
    </div>
  );
}
