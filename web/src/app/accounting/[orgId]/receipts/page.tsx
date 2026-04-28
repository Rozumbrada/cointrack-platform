"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface Receipt {
  syncId: string;
  profileId: string;
  profileName: string;
  ownerEmail: string;
  merchantName: string | null;
  date: string;
  totalWithVat: string;
  currency: string;
  paymentMethod: string | null;
  linkedAccountId?: string | null;
  accountName?: string | null;
}

export default function AccountantReceiptsPage() {
  const t = useTranslations("accounting_receipts");
  const locale = useLocale();
  const params = useParams<{ orgId: string }>();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [periodFrom, setPeriodFrom] = useState<string>("");
  const [periodTo, setPeriodTo] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((tk) =>
          api<{ receipts: Receipt[] }>(
            `/api/v1/accounting/orgs/${params.orgId}/receipts`,
            { token: tk },
          ),
        );
        setReceipts(res.receipts);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [params.orgId]);

  const filtered = useMemo(() => {
    let r = receipts;
    if (accountFilter !== "ALL") {
      r = r.filter((x) => x.linkedAccountId === accountFilter);
    }
    if (periodFrom) r = r.filter((x) => x.date >= periodFrom);
    if (periodTo) r = r.filter((x) => x.date <= periodTo);
    if (query) {
      const q = query.toLowerCase();
      r = r.filter(
        (x) =>
          x.merchantName?.toLowerCase().includes(q) ||
          x.profileName.toLowerCase().includes(q) ||
          x.ownerEmail.toLowerCase().includes(q),
      );
    }
    return r;
  }, [receipts, query, accountFilter, periodFrom, periodTo]);

  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of receipts) {
      if (r.linkedAccountId && r.accountName) map.set(r.linkedAccountId, r.accountName);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [receipts]);

  const total = useMemo(() => {
    return filtered.reduce((s, r) => s + (parseFloat(r.totalWithVat) || 0), 0);
  }, [filtered]);

  function fmt(amount: number, currency: string): string {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  }

  function labelPayment(p: string | null): string {
    switch (p) {
      case "CASH": return t("payment_cash");
      case "CARD": return t("payment_card");
      default: return "—";
    }
  }

  async function downloadZip() {
    try {
      const token = await withAuth((tk) => Promise.resolve(tk));
      const res = await fetch(
        `/api/v1/accounting/orgs/${params.orgId}/export.zip`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cointrack_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={downloadZip}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          {t("download_zip")}
        </button>
      </div>

      <div className="flex gap-3 flex-wrap">
        <input
          type="text"
          placeholder={t("search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[14rem] h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">{t("all_accounts")}</option>
          {accountOptions.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          type="date"
          value={periodFrom}
          onChange={(e) => setPeriodFrom(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          title={t("from_label")}
        />
        <input
          type="date"
          value={periodTo}
          onChange={(e) => setPeriodTo(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          title={t("to_label")}
        />
        <div className="bg-white rounded-lg border border-ink-200 px-4 h-10 grid place-items-center text-sm">
          {t("summary", { count: filtered.length, total: fmt(total, "CZK") })}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_date")}</th>
                <th className="px-6 py-3 font-medium">{t("th_merchant")}</th>
                <th className="px-6 py-3 font-medium">{t("th_profile")}</th>
                <th className="px-6 py-3 font-medium">{t("th_owner")}</th>
                <th className="px-6 py-3 font-medium">{t("th_account")}</th>
                <th className="px-6 py-3 font-medium">{t("th_payment")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((r) => (
                <tr key={r.syncId} className="hover:bg-ink-50/50">
                  <td className="px-6 py-3 text-ink-600 whitespace-nowrap">{r.date}</td>
                  <td className="px-6 py-3 font-medium text-ink-900">
                    {r.merchantName || "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-700">{r.profileName}</td>
                  <td className="px-6 py-3 text-ink-500 text-xs">{r.ownerEmail}</td>
                  <td className="px-6 py-3 text-ink-700 text-xs">{r.accountName ?? "—"}</td>
                  <td className="px-6 py-3 text-ink-600">{labelPayment(r.paymentMethod)}</td>
                  <td className="px-6 py-3 text-right tabular-nums font-semibold text-ink-900">
                    {fmt(parseFloat(r.totalWithVat), r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
