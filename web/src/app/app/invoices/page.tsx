"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import {
  Period,
  PeriodSelector,
  periodRange,
} from "@/components/app/PeriodSelector";
import { InvoiceEditor } from "@/components/app/InvoiceEditor";
import { ExportButton } from "@/components/app/ExportButton";

interface InvoiceData {
  profileId?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  supplierName?: string;
  customerName?: string;
  totalWithVat: string | number;     // server posílá string
  currency?: string;
  isExpense: boolean;
  paid?: boolean;                    // ne 'isPaid'!
  linkedTransactionId?: string;
  variableSymbol?: string;           // ne 'variabilniSymbol'
  fileKeys?: unknown;
  linkedAccountId?: string;
}

type AccountListEntry = { syncId: string; data: ServerAccount };

export default function InvoicesPage() {
  const t = useTranslations("invoices_page");
  const locale = useLocale();
  // Filtrování podle aktivního profilu — useSyncData() automaticky řeší
  // soft-delete + match na profileSyncId, a reaguje na přepnutí profilu
  // (event "cointrack:profile-changed").
  const { loading, error, profileSyncId, entitiesByProfile, reload } = useSyncData();
  const invoices = entitiesByProfile<InvoiceData>("invoices");
  const accounts = entitiesByProfile<ServerAccount>("accounts");

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "RECEIVED" | "ISSUED">("ALL");
  const [paidFilter, setPaidFilter] = useState<"ALL" | "PAID" | "UNPAID">("ALL");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [period, setPeriod] = useState<Period>("all");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [creating, setCreating] = useState(false);

  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);

  // Detekce existujících duplicit v rámci profilu — počítáno *před* aplikací
  // UI filtrů (datum/typ/uhrazeno), aby badge svítil i tehdy, když je
  // partner v jiném zobrazení. Save-time check (v InvoiceEditor) brání
  // dalšímu vzniku, tohle slouží k úklidu starých dupů.
  const dupNumbers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of invoices) {
      const n = (r.data.invoiceNumber ?? "").trim();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const result = new Set<string>();
    counts.forEach((c, n) => {
      if (c > 1) result.add(n);
    });
    return result;
  }, [invoices]);

  const filtered = useMemo(() => {
    return [...invoices]
      .filter((r) => {
        if (filter === "RECEIVED") return r.data.isExpense;
        if (filter === "ISSUED") return !r.data.isExpense;
        return true;
      })
      .filter((r) => {
        if (paidFilter === "ALL") return true;
        const isPaid = r.data.paid || !!r.data.linkedTransactionId;
        return paidFilter === "PAID" ? isPaid : !isPaid;
      })
      .filter((r) => {
        const d = r.data.issueDate;
        if (!d) return !range.from && !range.to;
        if (range.from && d < range.from) return false;
        if (range.to && d > range.to) return false;
        return true;
      })
      .filter((r) =>
        accountFilter === "ALL" ? true : r.data.linkedAccountId === accountFilter,
      )
      .filter((r) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          r.data.invoiceNumber?.toLowerCase().includes(q) ||
          r.data.supplierName?.toLowerCase().includes(q) ||
          r.data.customerName?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.data.issueDate ?? "").localeCompare(a.data.issueDate ?? ""));
  }, [invoices, query, filter, paidFilter, range, accountFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector
            period={period}
            onChange={setPeriod}
            custom={customRange}
            onCustomChange={setCustomRange}
          />
          <ExportButton type="invoices" profileSyncId={profileSyncId} />
          <button
            onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            {t("new_invoice")}
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <input
          type="text"
          placeholder={t("search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[14rem] h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm">
          {(["ALL", "RECEIVED", "ISSUED"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 ${
                filter === f ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {f === "ALL" ? t("filter_all") : f === "RECEIVED" ? t("filter_received") : t("filter_issued")}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm">
          {(["ALL", "PAID", "UNPAID"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setPaidFilter(f)}
              className={`px-4 py-2 ${
                paidFilter === f ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {f === "ALL" ? t("filter_all") : f === "PAID" ? t("filter_paid") : t("filter_unpaid")}
            </button>
          ))}
        </div>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">{t("filter_account_all")}</option>
          {accounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>{a.data.name}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {dupNumbers.size > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {t("dup_warning", { count: dupNumbers.size })}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">📄</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_number")}</th>
                <th className="px-6 py-3 font-medium">{t("th_partner")}</th>
                <th className="px-6 py-3 font-medium">{t("th_date")}</th>
                <th className="px-6 py-3 font-medium">{t("th_type")}</th>
                <th className="px-6 py-3 font-medium">{t("th_status")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((r) => (
                <tr
                  key={r.syncId}
                  className="hover:bg-ink-50/50 cursor-pointer"
                  onClick={() => { window.location.href = `/app/invoices/${r.syncId}`; }}
                >
                  <td className="px-6 py-3 font-medium text-ink-900 tabular-nums">
                    <div className="flex items-center gap-2">
                      <span>{r.data.invoiceNumber || "—"}</span>
                      {r.data.invoiceNumber &&
                        dupNumbers.has(r.data.invoiceNumber.trim()) && (
                          <span
                            className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium whitespace-nowrap"
                            title={t("dup_badge_tooltip")}
                          >
                            {t("dup_badge")}
                          </span>
                        )}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-ink-700 max-w-xs truncate">
                    {r.data.isExpense
                      ? r.data.supplierName || "—"
                      : r.data.customerName || "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-600">{r.data.issueDate || "—"}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-block text-[10px] uppercase px-1.5 py-0.5 rounded ${
                        r.data.isExpense
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {r.data.isExpense ? t("type_received") : t("type_issued")}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    {r.data.paid || r.data.linkedTransactionId ? (
                      <span className="text-emerald-700 text-xs font-medium">{t("status_paid")}</span>
                    ) : (
                      <span className="text-ink-500 text-xs">{t("status_unpaid")}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
                    {fmtAmt(r.data.totalWithVat, r.data.currency ?? "CZK", locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <InvoiceEditor
          initial={null}
          initialItems={[]}
          rawItemEntities={[]}
          profileSyncId={profileSyncId}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onSaved={async (syncId) => {
            setCreating(false);
            await reload();
            window.location.href = `/app/invoices/${syncId}`;
          }}
        />
      )}
    </div>
  );
}

function fmtAmt(amount: string | number | undefined, currency: string, locale: string = "cs-CZ"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}
