"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface Invoice {
  syncId: string;
  profileId: string;
  profileName: string;
  ownerEmail: string;
  invoiceNumber: string | null;
  isExpense: boolean;
  issueDate: string | null;
  dueDate: string | null;
  totalWithVat: string;
  currency: string;
  supplierName: string | null;
  customerName: string | null;
  paid: boolean;
}

export default function AccountantInvoicesPage() {
  const params = useParams<{ orgId: string }>();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "RECEIVED" | "ISSUED">("ALL");

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) =>
          api<{ invoices: Invoice[] }>(
            `/api/v1/accounting/orgs/${params.orgId}/invoices`,
            { token: t },
          ),
        );
        setInvoices(res.invoices);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [params.orgId]);

  const filtered = useMemo(() => {
    let res = invoices;
    if (filter === "RECEIVED") res = res.filter((i) => i.isExpense);
    else if (filter === "ISSUED") res = res.filter((i) => !i.isExpense);
    if (query) {
      const q = query.toLowerCase();
      res = res.filter(
        (r) =>
          r.invoiceNumber?.toLowerCase().includes(q) ||
          r.supplierName?.toLowerCase().includes(q) ||
          r.customerName?.toLowerCase().includes(q) ||
          r.profileName.toLowerCase().includes(q),
      );
    }
    return res;
  }, [invoices, query, filter]);

  const totals = useMemo(() => {
    let received = 0;
    let issued = 0;
    let unpaid = 0;
    for (const r of filtered) {
      const a = parseFloat(r.totalWithVat) || 0;
      if (r.isExpense) received += a;
      else issued += a;
      if (!r.paid) unpaid += a;
    }
    return { received, issued, unpaid };
  }, [filtered]);

  async function downloadZip() {
    try {
      const token = await withAuth((t) => Promise.resolve(t));
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
          <h1 className="text-2xl font-semibold text-ink-900">Faktury organizace</h1>
          <p className="text-sm text-ink-600 mt-1">
            Souhrn přijatých a vystavených faktur napříč všemi profily v organizaci.
          </p>
        </div>
        <button
          onClick={downloadZip}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          📦 Stáhnout vše (ZIP)
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Tile label="Přijaté faktury" value={fmt(totals.received, "CZK")} color="text-red-700" />
        <Tile label="Vystavené faktury" value={fmt(totals.issued, "CZK")} color="text-emerald-700" />
        <Tile label="Nezaplacené" value={fmt(totals.unpaid, "CZK")} color="text-amber-700" />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Hledat číslo faktury / partnera / profil…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
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
              {f === "ALL" ? "Vše" : f === "RECEIVED" ? "Přijaté" : "Vystavené"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">📄</div>
          <div className="font-medium text-ink-900">Žádné faktury</div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Číslo</th>
                <th className="px-6 py-3 font-medium">Datum</th>
                <th className="px-6 py-3 font-medium">Partner</th>
                <th className="px-6 py-3 font-medium">Typ</th>
                <th className="px-6 py-3 font-medium">Profil</th>
                <th className="px-6 py-3 font-medium">Stav</th>
                <th className="px-6 py-3 font-medium text-right">Částka</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((r) => (
                <tr key={r.syncId} className="hover:bg-ink-50/50">
                  <td className="px-6 py-3 font-medium text-ink-900 tabular-nums">
                    {r.invoiceNumber || "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-600">{r.issueDate || "—"}</td>
                  <td className="px-6 py-3 text-ink-700 max-w-xs truncate">
                    {r.isExpense ? r.supplierName : r.customerName || "—"}
                  </td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-block text-[10px] uppercase px-1.5 py-0.5 rounded ${
                        r.isExpense
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {r.isExpense ? "přijatá" : "vystavená"}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-ink-600 text-xs">{r.profileName}</td>
                  <td className="px-6 py-3">
                    {r.paid ? (
                      <span className="text-emerald-700 text-xs font-medium">✓ uhrazeno</span>
                    ) : (
                      <span className="text-amber-700 text-xs">nezaplaceno</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
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

function Tile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
