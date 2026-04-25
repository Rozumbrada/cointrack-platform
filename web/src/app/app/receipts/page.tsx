"use client";

import { useEffect, useMemo, useState } from "react";
import { sync, SyncEntity } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface ReceiptData {
  profileId?: string;
  categoryId?: string;
  transactionId?: string;     // = "spárováno s tx" (server NEPOSÍLÁ linkedTransactionId)
  merchantName?: string;
  date: string;
  time?: string;
  totalWithVat: string;       // server posílá string
  totalWithoutVat?: string;
  currency?: string;
  paymentMethod?: string;
  note?: string;              // ne 'notes'!
  photoKeys?: unknown;        // array, server posílá JSON
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
      .filter((e) => {
        if (e.deletedAt) return false;
        const d = e.data as Record<string, unknown>;
        return !(d.deletedAt != null && d.deletedAt !== 0);
      })
      .map((e) => ({ syncId: e.syncId, data: e.data as unknown as ReceiptData }))
      .filter((r) =>
        query ? r.data.merchantName?.toLowerCase().includes(query.toLowerCase()) : true,
      )
      .sort((a, b) => (b.data.date ?? "").localeCompare(a.data.date ?? ""));
  }, [receipts, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Účtenky</h1>
        <p className="text-sm text-ink-600 mt-1">
          Naskenované účtenky. Klikni na řádek pro detail.
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
            Naskenuj účtenku v mobilní aplikaci.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Obchodník</th>
                <th className="px-6 py-3 font-medium">Datum</th>
                <th className="px-6 py-3 font-medium">Platba</th>
                <th className="px-6 py-3 font-medium">Foto</th>
                <th className="px-6 py-3 font-medium text-right">Částka</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((r) => {
                const photos = Array.isArray(r.data.photoKeys) ? r.data.photoKeys : [];
                return (
                  <tr
                    key={r.syncId}
                    className="hover:bg-ink-50/50 cursor-pointer"
                    onClick={() => { window.location.href = `/app/receipts/${r.syncId}`; }}
                  >
                    <td className="px-6 py-3 font-medium text-ink-900">
                      {r.data.merchantName || "(bez názvu)"}
                    </td>
                    <td className="px-6 py-3 text-ink-600 whitespace-nowrap">
                      {r.data.date || "—"}
                      {r.data.time && <span className="text-ink-400 text-xs"> {r.data.time}</span>}
                    </td>
                    <td className="px-6 py-3 text-ink-600">{labelPayment(r.data.paymentMethod)}</td>
                    <td className="px-6 py-3 text-ink-600 text-xs">
                      {photos.length > 0 ? `📷 ${photos.length}` : "—"}
                    </td>
                    <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
                      {fmtAmt(r.data.totalWithVat, r.data.currency ?? "CZK")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtAmt(amount: string | number | undefined, currency: string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function labelPayment(p: string | undefined | null): string {
  switch (p) {
    case "CASH": return "Hotově";
    case "CARD": return "Kartou";
    default: return "—";
  }
}
