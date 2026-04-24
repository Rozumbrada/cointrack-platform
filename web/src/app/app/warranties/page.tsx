"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface WarrantyData {
  productName: string;
  merchant?: string;
  purchaseDate: string;
  warrantyUntil: string;
  priceAmount?: number;
  priceCurrency?: string;
  note?: string;
  profileId?: number;
}

export default function WarrantiesPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const warranties = entitiesByProfile<WarrantyData>("warranties");

  const sorted = useMemo(
    () =>
      [...warranties].sort((a, b) =>
        (a.data.warrantyUntil ?? "9999").localeCompare(b.data.warrantyUntil ?? "9999"),
      ),
    [warranties],
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Záruky</h1>
        <p className="text-sm text-ink-600 mt-1">
          Produkty se záruční lhůtou — seřazeno od nejbližší končící.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🛡️</div>
          <div className="font-medium text-ink-900">Žádné záruky</div>
          <p className="text-sm text-ink-600 mt-2">
            Přidej produkty pod zárukou v mobilní aplikaci (Účtenky → Detail → Záruka).
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Produkt</th>
                <th className="px-6 py-3 font-medium">Obchodník</th>
                <th className="px-6 py-3 font-medium">Koupě</th>
                <th className="px-6 py-3 font-medium">Záruka do</th>
                <th className="px-6 py-3 font-medium text-right">Cena</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map((w) => {
                const daysLeft =
                  w.data.warrantyUntil > today
                    ? Math.round(
                        (new Date(w.data.warrantyUntil).getTime() -
                          new Date(today).getTime()) /
                          86400_000,
                      )
                    : -1;
                const expired = daysLeft < 0;
                const warnSoon = daysLeft >= 0 && daysLeft <= 30;
                return (
                  <tr key={w.syncId} className={`hover:bg-ink-50/50 ${expired ? "opacity-50" : ""}`}>
                    <td className="px-6 py-3 font-medium text-ink-900">
                      {w.data.productName}
                    </td>
                    <td className="px-6 py-3 text-ink-600">{w.data.merchant || "—"}</td>
                    <td className="px-6 py-3 text-ink-600">{w.data.purchaseDate}</td>
                    <td className="px-6 py-3">
                      <div className="text-ink-900">{w.data.warrantyUntil}</div>
                      <div
                        className={`text-xs ${
                          expired
                            ? "text-red-700"
                            : warnSoon
                              ? "text-amber-700"
                              : "text-ink-500"
                        }`}
                      >
                        {expired
                          ? "vypršelo"
                          : daysLeft === 0
                            ? "končí dnes"
                            : `zbývá ${daysLeft} dní`}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
                      {w.data.priceAmount != null
                        ? fmt(w.data.priceAmount, w.data.priceCurrency ?? "CZK")
                        : "—"}
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

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
