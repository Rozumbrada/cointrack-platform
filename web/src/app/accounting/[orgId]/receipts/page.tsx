"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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
}

export default function AccountantReceiptsPage() {
  const params = useParams<{ orgId: string }>();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) =>
          api<{ receipts: Receipt[] }>(
            `/api/v1/accounting/orgs/${params.orgId}/receipts`,
            { token: t },
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
    if (!query) return receipts;
    const q = query.toLowerCase();
    return receipts.filter(
      (r) =>
        r.merchantName?.toLowerCase().includes(q) ||
        r.profileName.toLowerCase().includes(q) ||
        r.ownerEmail.toLowerCase().includes(q),
    );
  }, [receipts, query]);

  const total = useMemo(() => {
    return filtered.reduce((s, r) => s + (parseFloat(r.totalWithVat) || 0), 0);
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Účtenky organizace</h1>
        <p className="text-sm text-ink-600 mt-1">
          Souhrn všech naskenovaných účtenek od členů organizace.
        </p>
      </div>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Hledat obchodníka, profil nebo email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <div className="bg-white rounded-lg border border-ink-200 px-4 h-10 grid place-items-center text-sm">
          {filtered.length} účtenek · {fmt(total, "CZK")}
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
          <div className="text-4xl mb-3">🧾</div>
          <div className="font-medium text-ink-900">Žádné účtenky</div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Datum</th>
                <th className="px-6 py-3 font-medium">Obchodník</th>
                <th className="px-6 py-3 font-medium">Profil</th>
                <th className="px-6 py-3 font-medium">Vlastník</th>
                <th className="px-6 py-3 font-medium">Platba</th>
                <th className="px-6 py-3 font-medium text-right">Částka</th>
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

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function labelPayment(p: string | null): string {
  switch (p) {
    case "CASH":
      return "Hotově";
    case "CARD":
      return "Kartou";
    default:
      return "—";
  }
}
