"use client";

import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import type { ReportExportType } from "@academic-precision/contracts";
import { Button, toast } from "@academic-precision/ui";
import { createReportExport, downloadExportCsv, fetchExportStatus } from "../../lib/api/reports";
import { useWorkspace } from "../../lib/workspace-provider";

async function waitForReady(workspaceId: string, exportId: string, attempts = 10): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const status = await fetchExportStatus(workspaceId, exportId);
    if (status.status === "READY") return;
    if (status.status === "FAILED") throw new Error(status.errorMessage ?? "فشل التصدير");
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error("انتهت مهلة انتظار التصدير");
}

const UTF8_BOM = String.fromCharCode(0xfeff);

function downloadCsvBlob(filename: string, csv: string): void {
  const blob = new Blob([UTF8_BOM + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** UTF-8 CSV only (§23) — no PDF/XLSX exists in this product. */
export function ExportCsvButton({ type, studentId, groupId, monthId, filename }: { type: ReportExportType; studentId?: string; groupId?: string; monthId?: string; filename: string }) {
  const { workspaceId, canWrite } = useWorkspace();

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await createReportExport(workspaceId!, { type, format: "CSV", studentId, groupId, monthId });
      if (created.status !== "READY") await waitForReady(workspaceId!, created.exportId);
      const csv = await downloadExportCsv(workspaceId!, created.exportId);
      downloadCsvBlob(filename, csv);
    },
    onError: () => toast.error("تعذّر تصدير التقرير"),
  });

  if (!canWrite("REPORT_EXPORT")) return null;

  return (
    <Button variant="outline" size="sm" onClick={() => mutation.mutate()} loading={mutation.isPending}>
      <Download className="h-4 w-4" aria-hidden />
      تصدير CSV
    </Button>
  );
}
