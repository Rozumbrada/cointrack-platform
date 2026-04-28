"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { withAuth } from "@/lib/auth-store";
import { FormDialog, Field, inputClass } from "./FormDialog";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export function ExportButton({
  type,
  profileSyncId,
}: {
  type: "receipts" | "invoices";
  profileSyncId: string | null;
}) {
  const t = useTranslations("export_button");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [exporting, setExporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function exportXml() {
    if (!profileSyncId) {
      setErr(t("no_profile"));
      return;
    }
    setExporting(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ profileId: profileSyncId });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
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
      setOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-700"
      >
        {t("button")}
      </button>
      {open && (
        <FormDialog
          title={type === "receipts" ? t("title_receipts") : t("title_invoices")}
          onClose={() => setOpen(false)}
          onSave={exportXml}
          saving={exporting}
          error={err}
          saveLabel={t("save_label")}
        >
          <p className="text-sm text-ink-600">{t("description")}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("from_optional")}>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label={t("to_optional")}>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </FormDialog>
      )}
    </>
  );
}
