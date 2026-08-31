"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import type { ReportExportFormat, ReportExportType } from "@academic-precision/contracts";
import { Button, toast } from "@academic-precision/ui";
import { createReportExport, downloadExportFile, fetchExportStatus } from "../../lib/api/reports";
import { useWorkspace } from "../../lib/workspace-provider";

async function waitForReady(workspaceId: string, exportId: string, attempts = 12): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const status = await fetchExportStatus(workspaceId, exportId);
    if (status.status === "READY") return;
    if (status.status === "FAILED") throw new Error(status.errorMessage ?? "فشل التصدير");
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("انتهت مهلة انتظار التصدير");
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Premium XLSX / PDF export triggers for any report type. Creates the export,
 * waits for READY, then downloads the server-rendered file (branded, RTL). The
 * server re-checks permission + entitlement + group scope + finance visibility
 * at download — this is UI convenience only. Hidden without REPORT_EXPORT.
 */
export function ReportExportButtons({
  type,
  studentId,
  groupId,
  monthId,
  fallbackName,
  disabled,
}: {
  type: ReportExportType;
  studentId?: string;
  groupId?: string;
  monthId?: string;
  fallbackName: string;
  disabled?: boolean;
}) {
  const { workspaceId, canWrite } = useWorkspace();
  const [busy, setBusy] = useState<ReportExportFormat | null>(null);

  async function run(format: ReportExportFormat) {
    if (!workspaceId) return;
    setBusy(format);
    try {
      const created = await createReportExport(workspaceId, { type, format, studentId, groupId, monthId });
      if (created.status !== "READY") await waitForReady(workspaceId, created.exportId);
      const { blob, filename } = await downloadExportFile(workspaceId, created.exportId);
      saveBlob(blob, filename ?? `${fallbackName}.${format.toLowerCase()}`);
    } catch {
      toast.error("تعذر إنشاء التقرير. حاول مرة أخرى.");
    } finally {
      setBusy(null);
    }
  }

  if (!canWrite("REPORT_EXPORT")) return null;

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => run("XLSX")} loading={busy === "XLSX"} disabled={disabled || busy !== null} className="gap-1.5">
        <FileSpreadsheet className="h-4 w-4" aria-hidden />
        تصدير Excel
      </Button>
      <Button variant="outline" size="sm" onClick={() => run("PDF")} loading={busy === "PDF"} disabled={disabled || busy !== null} className="gap-1.5">
        <FileText className="h-4 w-4" aria-hidden />
        تصدير PDF
      </Button>
    </div>
  );
}
