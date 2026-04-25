"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface PlannedData {
  name: string;
  amount: number;
  currency: string;
  /** Server posílá lowercase ("expense"/"income"). Vždy normalizuj přes toUpperCase() při porovnávání. */
  type: string;
  nextDate: string;
  period: string;
  accountId?: number;
  isPaused?: boolean;
  profileId?: number;
}

export default function PlannedPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const planned = entitiesByProfile<PlannedData>("planned_payments");

  const sorted = useMemo(
    () =>
      [...planned].sort((a, b) => (a.data.nextDate ?? "").localeCompare(b.data.nextDate ?? "")),
    [planned],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Plánované platby</h1>
        <p className="text-sm text-ink-600 mt-1">
          Opakující se příjmy a výdaje (nájem, předplatné, výplata).
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
          <div className="text-4xl mb-3">📅</div>
          <div className="font-medium text-ink-900">Žádné plánované platby</div>
          <p className="text-sm text-ink-600 mt-2">
            Vytvoř v mobilní aplikaci (např. nájem, Netflix).
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {sorted.map((p) => (
              <li key={p.syncId} className="px-6 py-4 flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full grid place-items-center text-sm ${
                    p.data.type?.toUpperCase() === "INCOME"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {p.data.type?.toUpperCase() === "INCOME" ? "↓" : "↑"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate flex items-center gap-2">
                    {p.data.name}
                    {p.data.isPaused && (
                      <span className="text-[10px] uppercase tracking-wide bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">
                        pozastaveno
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-500">
                    Další: {p.data.nextDate} · {p.data.period}
                  </div>
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    p.data.type?.toUpperCase() === "INCOME" ? "text-emerald-700" : "text-ink-900"
                  }`}
                >
                  {p.data.type?.toUpperCase() === "INCOME" ? "+" : "−"}
                  {fmt(p.data.amount, p.data.currency)}
                </div>
              </li>
            ))}
          </ul>
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
