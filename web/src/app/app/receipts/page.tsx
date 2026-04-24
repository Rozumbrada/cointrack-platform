"use client";

import { useEffect, useMemo, useState } from "react";
import { sync, SyncEntity } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface ReceiptData {
  merchantName: string;
  merchantIco?: string;
  date: string;
  totalWithVat: number;
  paymentMethod: string;
  linkedTransactionId?: number;
  fileUris?: string;
}

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<SyncEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) => sync.pull(t));
        setReceipts(res.entities["receipts"] ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return [...receipts]
      .filter((e) => !e.deletedAt)
      .map((e) => ({ syncId: e.syncId, data: e.data as unknown as ReceiptData }))
      .filter((r) =>
        query
          ? r.data.merchantName?.toLowerCase().includes(query.toLowerCase())
          : true,
      )
      .sort((a, b) => (b.data.date ?? "").localeCompare(a.data.date ?? ""));
  }, [receipts, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Účtenky</h1>
        <p className="text-sm text-ink-600 mt-1">
          Naskenované účtenky z mobilní aplikace. Upload z webu bude v budoucí verzi.
        </p>
      </div>

      <input
        type="text"
        placeholder="Hledat obchodníka…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <div className="font-medium text-ink-900">Žádné účtenky</div>
          <p className="text-sm text-ink-600 mt-2">
            Naskenuj účtenku v mobilní aplikaci — zobrazí se tu po synchronizaci.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Obchodník</th>
                <th className="px-6 py-3 font-medium">IČO</th>
                <th className="px-6 py-3 font-medium">Datum</th>
                <th className="px-6 py-3 font-medium">Platba</th>
                <th className="px-6 py-3 font-medium">Spárováno</th>
                <th className="px-6 py-3 font-medium text-right">Částka</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((r) => (
                <tr key={r.syncId} className="hover:bg-ink-50/50">
                  <td className="px-6 py-3 font-medium text-ink-900">
                    {r.data.merchantName || "(bez názvu)"}
                  </td>
                  <td className="px-6 py-3 text-ink-600 tabular-nums">
                    {r.data.merchantIco || "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-600">{r.data.date || "—"}</td>
                  <td className="px-6 py-3 text-ink-600">
                    {labelPayment(r.data.paymentMethod)}
                  </td>
                  <td className="px-6 py-3">
                    {r.data.linkedTransactionId ? (
                      <span className="inline-block text-[10px] uppercase bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                        ✓ banka
                      </span>
                    ) : (
                      <span className="text-ink-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
                    {fmt(r.data.totalWithVat, "CZK")}
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

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function labelPayment(p: string): string {
  switch (p) {
    case "CASH":
      return "Hotově";
    case "CARD":
      return "Kartou";
    default:
      return "—";
  }
}
