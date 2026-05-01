"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { withAuth } from "@/lib/auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * Export Pohoda XML — bez dialogu. Klik = přímo stahuje.
 *
 * Pokud `selectedIds` je non-empty, server vyfiltruje jen tyto entity.
 * Pokud je prázdný, server exportuje vše v profilu (bez date range — pro
 * filtrování má teď uživatel klasický date selector na stránce + manuální
 * výběr přes checkboxy).
 *
 * Za běhu je tlačítko disabled (spinner v label) a zachycuje chyby
 * s alert(). Soubor se stáhne jako attachment z `Content-Disposition` header.
 */
export function ExportButton({
  type,
  profileSyncId,
  selectedIds,
}: {
  type: "receipts" | "invoices";
  profileSyncId: string | null;
  /** Pokud non-empty, exportují se JEN tyto syncIds. */
  selectedIds?: string[];
}) {
  const t = useTranslations("export_button");
  const [exporting, setExporting] = useState(false);

  async function exportXml() {
    if (!profileSyncId) {
      alert(t("no_profile"));
      return;
    }
    setExporting(true);
    try {
      const params = new URLSearchParams({ profileId: profileSyncId });
      if (selectedIds && selectedIds.length > 0) {
        params.set("ids", selectedIds.join(","));
      }
      const url = `${API_URL}/api/v1/export/${type}.xml?${params}`;

      const res = await withAuth((token) =>
        fetch(url, { headers: { Authorization: `Bearer ${token}` } }),
      );
      if (!res.ok) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          msg = JSON.parse(text).message ?? msg;
        } catch {
          /* not JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const filename =
        cd.match(/filename="?([^"]+)"?/)?.[1] ??
        (type === "receipts" ? t("filename_receipts") : t("filename_invoices"));

      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      alert(`${t("export_failed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  const hasSelection = selectedIds && selectedIds.length > 0;
  const label = hasSelection
    ? t("button_selected", { count: selectedIds!.length })
    : t("button");

  return (
    <button
      onClick={exportXml}
      disabled={exporting || !profileSyncId}
      className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 disabled:opacity-60 text-sm font-medium text-ink-700 whitespace-nowrap"
    >
      {exporting ? t("exporting") : label}
    </button>
  );
}
