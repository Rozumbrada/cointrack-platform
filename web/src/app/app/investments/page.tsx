"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface InvestmentPositionData {
  symbol: string;
  name?: string;
  quantity: number;
  averageBuyPrice: number;
  currentPrice?: number;
  currency: string;
  accountId?: number;
  profileId?: number;
}

interface AccountData {
  id?: number;
  name: string;
  type: string;
}

export default function InvestmentsPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const positions = entitiesByProfile<InvestmentPositionData>("investment_positions");
  const accounts = entitiesByProfile<AccountData>("accounts");

  const accMap = useMemo(() => {
    const m = new Map<number, AccountData>();
    accounts.forEach((a) => a.data.id && m.set(a.data.id, a.data));
    return m;
  }, [accounts]);

  const sorted = useMemo(
    () => [...positions].sort((a, b) => a.data.symbol.localeCompare(b.data.symbol)),
    [positions],
  );

  const totals = useMemo(() => {
    let cost = 0;
    let value = 0;
    for (const p of positions) {
      const cur = p.data.currentPrice ?? p.data.averageBuyPrice;
      cost += p.data.quantity * p.data.averageBuyPrice;
      value += p.data.quantity * cur;
    }
    return { cost, value, pnl: value - cost };
  }, [positions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Investice</h1>
        <p className="text-sm text-ink-600 mt-1">
          Pozice v akcích, ETF, kryptoměnách.
        </p>
      </div>

      {Object.keys(totals).length > 0 && positions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Tile label="Nákupní hodnota" value={fmt(totals.cost, "CZK")} />
          <Tile label="Aktuální hodnota" value={fmt(totals.value, "CZK")} />
          <Tile
            label="Zisk / ztráta"
            value={(totals.pnl >= 0 ? "+" : "") + fmt(totals.pnl, "CZK")}
            color={totals.pnl >= 0 ? "text-emerald-700" : "text-red-700"}
          />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">📈</div>
          <div className="font-medium text-ink-900">Žádné pozice</div>
          <p className="text-sm text-ink-600 mt-2">
            Přidej investiční účet v mobilní aplikaci a zaznamenej své pozice.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Symbol</th>
                <th className="px-6 py-3 font-medium">Účet</th>
                <th className="px-6 py-3 font-medium text-right">Ks</th>
                <th className="px-6 py-3 font-medium text-right">Cena nákup</th>
                <th className="px-6 py-3 font-medium text-right">Cena aktuální</th>
                <th className="px-6 py-3 font-medium text-right">P/L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map((p) => {
                const cur = p.data.currentPrice ?? p.data.averageBuyPrice;
                const pnl = (cur - p.data.averageBuyPrice) * p.data.quantity;
                const pnlPct =
                  ((cur - p.data.averageBuyPrice) / p.data.averageBuyPrice) * 100;
                const acc = p.data.accountId ? accMap.get(p.data.accountId) : undefined;
                return (
                  <tr key={p.syncId} className="hover:bg-ink-50/50">
                    <td className="px-6 py-3 font-medium text-ink-900">
                      <div>{p.data.symbol}</div>
                      {p.data.name && (
                        <div className="text-xs text-ink-500 font-normal">
                          {p.data.name}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-ink-600">
                      {acc?.name ?? "—"}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums">
                      {p.data.quantity.toLocaleString("cs-CZ")}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums text-ink-600">
                      {fmt(p.data.averageBuyPrice, p.data.currency)}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums">
                      {fmt(cur, p.data.currency)}
                    </td>
                    <td
                      className={`px-6 py-3 text-right tabular-nums font-semibold ${
                        pnl >= 0 ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {pnl >= 0 ? "+" : ""}
                      {fmt(pnl, p.data.currency)}
                      <div className="text-xs font-normal">
                        {pnl >= 0 ? "+" : ""}
                        {pnlPct.toFixed(1)} %
                      </div>
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

function Tile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${color ?? "text-ink-900"}`}>
        {value}
      </div>
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
