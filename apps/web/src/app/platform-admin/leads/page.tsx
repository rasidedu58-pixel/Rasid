"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  ErrorState,
  Input,
  LoadingRegion,
  MetricCell,
  MetricStrip,
  PermissionDeniedState,
  Textarea,
  cn,
  formatDate,
  formatDateTime,
  toast,
} from "@academic-precision/ui";
import {
  PLATFORM_LEAD_FILTERS,
  PLATFORM_LEAD_STATUSES,
  buildWhatsappLink,
  type PlatformLead,
  type PlatformLeadFilter,
} from "@academic-precision/contracts";
import { MessageCircle, Phone, Mail, CalendarClock, CheckCircle2 } from "lucide-react";
import { PageHeader } from "../../../components/shell/page-header";
import { qk } from "../../../lib/query-keys";
import { fetchPlatformLeads, fetchPlatformLeadMetrics, updatePlatformLead } from "../../../lib/api/platform-leads";
import { isForbidden } from "../../../lib/api/client";
import { PLATFORM_LEAD_STATUS_LABEL, platformLeadStatusTone, SUB_STATE_LABEL } from "../../../lib/platform-labels";

const FILTER_LABEL: Record<PlatformLeadFilter, string> = {
  ALL: "الكل",
  NEW: "جديد",
  NEEDS_FOLLOW_UP: "يحتاج متابعة",
  POSTPONED: "مؤجّل",
  CONTACTED: "تم التواصل",
  CONVERTED: "تحوّل لعميل",
};

/**
 * Platform Admin — العملاء المحتملون. Every new self-service signup lands here
 * so the Rasid team can follow it up: contact, schedule a call back, record a
 * note, and mark converted. A small follow-up ledger, NOT a CRM. Identity and
 * subscription data are read live from the customer's own record — nothing is
 * copied into the lead. The WhatsApp button OPENS a chat with a ready message;
 * it never sends anything.
 */
export default function PlatformLeadsPage() {
  const [filter, setFilter] = useState<PlatformLeadFilter>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const metrics = useQuery({
    queryKey: qk.platformAdmin.leadMetrics(),
    queryFn: fetchPlatformLeadMetrics,
    retry: (n, e) => !isForbidden(e) && n < 2,
  });

  const leads = useQuery({
    queryKey: qk.platformAdmin.leads({ filter, search }),
    queryFn: () => fetchPlatformLeads({ filter, search: search || undefined }),
    retry: (n, e) => !isForbidden(e) && n < 2,
  });

  const items = leads.data?.items ?? [];

  if (leads.isLoading) return <LoadingRegion className="min-h-[60vh]" />;
  if (isForbidden(leads.error)) return <PermissionDeniedState />;
  if (leads.isError || !leads.data) return <ErrorState onRetry={() => leads.refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="العملاء المحتملون"
        description="كل من سجّل حديثًا في المنصة — تابِعه حتى يصبح عميلًا. تُجلب بيانات التواصل من حساب العميل مباشرة."
      />

      {metrics.data ? (
        <MetricStrip columns={4}>
          <MetricCell label="الإجمالي" value={metrics.data.total} />
          <MetricCell label="جديد" value={metrics.data.newCount} tone={metrics.data.newCount > 0 ? "brand" : "default"} />
          <MetricCell
            label="يحتاج متابعة"
            value={metrics.data.needsFollowUp}
            tone={metrics.data.needsFollowUp > 0 ? "warning" : "default"}
            sub={metrics.data.dueToday > 0 ? `${metrics.data.dueToday} اليوم` : undefined}
          />
          <MetricCell label="تحوّل لعميل" value={metrics.data.converted} tone={metrics.data.converted > 0 ? "success" : "default"} />
        </MetricStrip>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {PLATFORM_LEAD_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                filter === f ? "border-brand bg-brand/10 text-brand" : "border-border text-text-secondary hover:bg-surface-sunken",
              )}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
          className="flex gap-2"
        >
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="بحث بالاسم أو الهاتف أو البريد…"
            className="max-w-sm"
          />
          <Button type="submit" variant="secondary">
            بحث
          </Button>
          {search ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchInput("");
                setSearch("");
              }}
            >
              مسح
            </Button>
          ) : null}
        </form>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-text-tertiary">
            {search || filter !== "ALL" ? "لا توجد نتائج مطابقة." : "لا يوجد عملاء محتملون بعد. سيظهر هنا كل تسجيل جديد."}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {leads.data.page.hasNext ? (
            <p className="text-xs text-text-tertiary">تُعرض أهم النتائج حسب الأولوية. استخدم البحث أو التصنيفات لتضييق القائمة.</p>
          ) : null}
          {items.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      )}
    </div>
  );
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function LeadCard({ lead }: { lead: PlatformLead }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(lead.note ?? "");
  const [followUp, setFollowUp] = useState(toDateInputValue(lead.nextFollowUpAt));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["platform-admin", "leads"] });
  };

  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof updatePlatformLead>[1]) => updatePlatformLead(lead.id, body),
    onSuccess: () => {
      invalidate();
      toast.success("تم تحديث العميل المحتمل");
    },
    onError: () => toast.error("تعذّر تحديث العميل المحتمل"),
  });

  const overdue =
    lead.nextFollowUpAt != null &&
    new Date(lead.nextFollowUpAt).getTime() < Date.now() &&
    !["CONVERTED", "NOT_INTERESTED"].includes(lead.status);

  // WhatsApp OPENS a chat with a prefilled message — never auto-sends. Hidden
  // entirely when there is no usable phone number.
  const waMessage = `السلام عليكم${lead.ownerName ? " " + lead.ownerName : ""}، معك فريق راصد. تواصلنا معك بخصوص تسجيلك في منصة راصد لإدارة الحلقات — هل نقدر نساعدك في البدء؟`;
  const waLink = buildWhatsappLink(lead.ownerPhone, waMessage);

  const saveFollowUp = () => {
    // Send the chosen day as an ISO datetime (start of day, local) or clear it.
    const iso = followUp ? new Date(`${followUp}T00:00:00`).toISOString() : null;
    mutation.mutate({ nextFollowUpAt: iso, status: iso && lead.status === "NEW" ? "FOLLOW_UP" : undefined });
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        {/* Header: name + status + subscription hint */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold text-text-primary">{lead.ownerName ?? "—"}</span>
              <Badge tone={platformLeadStatusTone(lead.status)}>{PLATFORM_LEAD_STATUS_LABEL[lead.status] ?? lead.status}</Badge>
              {lead.hasActivePaidSubscription ? <Badge tone="success">مشترك مدفوع</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-tertiary">
              {lead.workspaceName ? (
                <Link href={`/platform-admin/workspaces/${lead.workspaceId}`} className="text-brand hover:underline">
                  {lead.workspaceName}
                </Link>
              ) : null}
              <span>سجّل {formatDate(lead.createdAt)}</span>
              {lead.subscriptionState ? (
                <span>
                  · {SUB_STATE_LABEL[lead.subscriptionState] ?? lead.subscriptionState}
                  {lead.trialEndsAt ? ` حتى ${formatDate(lead.trialEndsAt)}` : ""}
                </span>
              ) : null}
            </div>
          </div>
          {waLink ? (
            <a href={waLink} target="_blank" rel="noopener noreferrer" className="shrink-0">
              <Button type="button" variant="secondary" size="sm">
                <MessageCircle className="h-4 w-4" aria-hidden />
                واتساب
              </Button>
            </a>
          ) : null}
        </div>

        {/* Contact details */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
          {lead.ownerPhone ? (
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
              <span dir="ltr" className="tabular-nums">
                {lead.ownerPhone}
              </span>
            </span>
          ) : null}
          {lead.ownerEmail ? (
            <span className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
              <span dir="ltr">{lead.ownerEmail}</span>
            </span>
          ) : null}
          {lead.lastContactAt ? (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              آخر تواصل {formatDateTime(lead.lastContactAt)}
            </span>
          ) : null}
          {lead.nextFollowUpAt ? (
            <span className={cn("flex items-center gap-1.5", overdue ? "font-medium text-danger" : "")}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              {overdue ? "متأخرة" : "متابعة"} {formatDate(lead.nextFollowUpAt)}
            </span>
          ) : null}
        </div>

        {/* Controls: status, mark-contacted, follow-up date */}
        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-xs text-text-tertiary">
            الحالة
            <select
              value={lead.status}
              onChange={(e) => mutation.mutate({ status: e.target.value as PlatformLead["status"] })}
              disabled={mutation.isPending}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary"
            >
              {PLATFORM_LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PLATFORM_LEAD_STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-text-tertiary">
            متابعة قادمة
            <input
              type="date"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text-primary"
            />
          </label>
          {followUp !== toDateInputValue(lead.nextFollowUpAt) ? (
            <Button type="button" variant="secondary" size="sm" onClick={saveFollowUp} disabled={mutation.isPending}>
              حفظ الموعد
            </Button>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => mutation.mutate({ markContactedNow: true })}
            disabled={mutation.isPending}
          >
            سجّل تواصلًا الآن
          </Button>
        </div>

        {/* Note */}
        <div className="flex flex-col gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة داخلية عن هذا العميل…"
            rows={2}
          />
          {note !== (lead.note ?? "") ? (
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => mutation.mutate({ note: note.trim() || null })} disabled={mutation.isPending}>
                حفظ الملاحظة
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setNote(lead.note ?? "")}>
                تراجع
              </Button>
            </div>
          ) : null}
          {lead.updatedByName ? <p className="text-xs text-text-tertiary">آخر تعديل بواسطة {lead.updatedByName}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
