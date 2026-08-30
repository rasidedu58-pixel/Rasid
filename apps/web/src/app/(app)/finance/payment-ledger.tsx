"use client";

import { useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Receipt, RotateCcw } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  SkeletonRows,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  cn,
  formatDate,
  formatMoney,
} from "@academic-precision/ui";
import type { PaymentLedgerItem } from "@academic-precision/contracts";
import { useWorkspace } from "../../../lib/workspace-provider";
import { qk } from "../../../lib/query-keys";
import { fetchPaymentLedger } from "../../../lib/api/finance";
import { ReversePaymentDialog } from "./reverse-payment-dialog";

const METHODS: Array<{ value: string | null; label: string }> = [
  { value: null, label: "كل الطرق" },
  { value: "CASH", label: "نقدي" },
  { value: "TRANSFER", label: "تحويل" },
  { value: "WALLET", label: "محفظة" },
  { value: "OTHER", label: "أخرى" },
];
const METHOD_LABEL: Record<string, string> = { CASH: "نقدي", TRANSFER: "تحويل", WALLET: "محفظة", OTHER: "أخرى" };

export function PaymentLedger() {
  const { workspaceId, hasPermission, canWrite } = useWorkspace();
  const ws = workspaceId ?? "";
  const canReverse = canWrite("CORE_OPERATIONS") && hasPermission("payments.record");

  const [method, setMethod] = useState<string | null>(null);
  const [onlyReversed, setOnlyReversed] = useState(false);
  const [reversing, setReversing] = useState<PaymentLedgerItem | null>(null);

  const filters = { method: method ?? undefined, status: onlyReversed ? "REVERSED" : undefined };
  const query = useInfiniteQuery({
    queryKey: workspaceId ? qk.finance.ledger(ws, filters) : ["ledger", "none"],
    queryFn: ({ pageParam }) => fetchPaymentLedger(ws, { ...filters, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page?.nextCursor ?? null,
    enabled: !!workspaceId,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {METHODS.map((m) => (
          <Chip key={m.label} active={method === m.value} onClick={() => setMethod(m.value)}>{m.label}</Chip>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Chip active={onlyReversed} onClick={() => setOnlyReversed((v) => !v)}>المعكوسة فقط</Chip>
      </div>

      {query.isLoading ? (
        <SkeletonRows rows={6} />
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Receipt className="h-8 w-8 text-text-tertiary" aria-hidden />} title="لا توجد دفعات" description="ستظهر هنا كل الدفعات المسجّلة عبر مجموعاتك." />
      ) : (
        <>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الطالب</TableHead>
                  <TableHead className="hidden sm:table-cell">المجموعة</TableHead>
                  <TableHead className="text-end">المبلغ</TableHead>
                  <TableHead className="hidden md:table-cell">الطريقة</TableHead>
                  <TableHead className="hidden lg:table-cell">التاريخ</TableHead>
                  <TableHead className="hidden xl:table-cell">سجّلها</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-end" aria-label="إجراء" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  const reversed = p.status === "REVERSED";
                  return (
                    <TableRow key={p.id} className={cn("transition-colors hover:bg-surface-sunken/40", reversed && "opacity-70")}>
                      <TableCell>
                        <Link href={`/students/${p.studentId}`} className="font-medium text-text-primary hover:text-brand">{p.studentName}</Link>
                        <span className="mt-0.5 block text-xs text-text-tertiary sm:hidden">{p.groupName}</span>
                      </TableCell>
                      <TableCell className="hidden text-sm text-text-secondary sm:table-cell">{p.groupName}</TableCell>
                      <TableCell className={cn("text-end text-base font-semibold tabular-nums", reversed ? "text-text-tertiary line-through" : "text-text-primary")}>{formatMoney(p.amountMinor)}</TableCell>
                      <TableCell className="hidden md:table-cell"><Badge tone="neutral">{METHOD_LABEL[p.method] ?? p.method}</Badge></TableCell>
                      <TableCell className="hidden text-sm tabular-nums text-text-secondary lg:table-cell">{formatDate(p.paidAt)}</TableCell>
                      <TableCell className="hidden text-sm text-text-tertiary xl:table-cell">{p.recordedByName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge tone={reversed ? "danger" : "success"}>{reversed ? "معكوسة" : "مسجّلة"}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        {canReverse && !reversed ? (
                          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => setReversing(p)}>
                            <RotateCcw className="h-4 w-4" aria-hidden />
                            عكس
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
          {query.hasNextPage ? (
            <div className="mt-2 flex justify-center">
              <Button variant="outline" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>عرض المزيد</Button>
            </div>
          ) : null}
        </>
      )}

      {reversing ? (
        <ReversePaymentDialog
          paymentId={reversing.id}
          amountMinor={reversing.amountMinor}
          studentName={reversing.studentName}
          onClose={() => setReversing(null)}
          onDone={() => query.refetch()}
        />
      ) : null}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "focus-ring rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-brand bg-brand-subtle/50 text-brand-subtle-foreground" : "border-border text-text-secondary hover:bg-surface-sunken",
      )}
    >
      {children}
    </button>
  );
}
