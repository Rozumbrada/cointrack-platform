"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerAccount,
  ServerCategory,
  ServerTransaction,
  computeAccountBalance,
  toUiTransaction,
} from "@/lib/sync-types";

export default function DashboardPage() {
  const { loading, error, entitiesByProfile } = useSyncData();

  const accountEntities = entitiesByProfile<ServerAccount>("accounts");
  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const categoryEntities = entitiesByProfile<ServerCategory>("categories");

  // Map kategorie syncId → kategorie data
  const catMap = useMemo(() => {
    const m = new Map<string, ServerCategory>();
    categoryEntities.forEach((c) => m.set(c.syncId, c.data));
    return m;
  }, [categoryEntities]);

  // UI transactions s odvozeným typem
  const uiTxs = useMemo(
    () => txEntities.map((e) => toUiTransaction(e.syncId, e.data)),
    [txEntities],
  );

  // Celkový zůstatek per měna — počítáno z initialBalance + sum(transakcí na účtu).
  // Ignoruj měny s nulovým součtem (vyhne se zmatení v UI když máš dávno smazané účty
  // různých měn, ale aktuální stav je 0).
  const totalBalance = useMemo(() => {
    const totals: Record<string, number> = {};
    const hasAny: Record<string, boolean> = {};
    for (const acc of accountEntities) {
      if (acc.data.excludedFromTotal) continue;
      const live = computeAccountBalance(acc.data, txEntities, acc.syncId);
      totals[acc.data.currency] = (totals[acc.data.currency] ?? 0) + live;
      hasAny[acc.data.currency] = true;
    }
    // Skryj měny, kde součet je 0 a neexistuje žádný účet (artefakt smazaných dat)
    return Object.fromEntries(
      Object.entries(totals).filter(([cur, amount]) => hasAny[cur] && Math.abs(amount) > 0.005),
    );
  }, [accountEntities, txEntities]);

  // Měsíční příjmy/výdaje
  const monthlyStats = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    let income = 0;
    let expense = 0;
    for (const tx of uiTxs) {
      if (!tx.date?.startsWith(monthKey)) continue;
      if (tx.type === "INCOME") income += tx.amount;
      else if (tx.type === "EXPENSE") expense += tx.amount;
    }
    return { income, expense };
  }, [uiTxs]);

  // Posledních 10 transakcí
  const recent = useMemo(() => {
    return [...uiTxs]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, 10);
  }, [uiTxs]);

  // Top 5 kategorií výdajů tento měsíc
  const topExpenseCats = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const sums = new Map<string | null, number>();
    for (const tx of uiTxs) {
      if (tx.type !== "EXPENSE") continue;
      if (!tx.date?.startsWith(monthKey)) continue;
      const cid = tx.categorySyncId ?? null;
      sums.set(cid, (sums.get(cid) ?? 0) + tx.amount);
    }
    return Array.from(sums.entries())
      .map(([cid, amount]) => ({
        cid,
        amount,
        category: cid ? catMap.get(cid) : undefined,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [uiTxs, catMap]);

  // 6-měsíční trend
  const trend = useMemo(() => {
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const tx of uiTxs) {
      if (!tx.date) continue;
      const ym = tx.date.slice(0, 7);
      const b = byMonth.get(ym) ?? { income: 0, expense: 0 };
      if (tx.type === "INCOME") b.income += tx.amount;
      else if (tx.type === "EXPENSE") b.expense += tx.amount;
      byMonth.set(ym, b);
    }
    const result: Array<{ month: string; income: number; expense: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = byMonth.get(ym) ?? { income: 0, expense: 0 };
      result.push({ month: ym, ...b });
    }
    return result;
  }, [uiTxs]);

  const maxExpenseCat = topExpenseCats[0]?.amount ?? 1;
  const maxTrend = Math.max(...trend.flatMap((m) => [m.income, m.expense]), 1);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Přehled</h1>
        <p className="text-sm text-ink-600 mt-1">
          Přehled financí pro aktivní profil.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile label="Celkový zůstatek">
          <div className="space-y-0.5">
            {Object.entries(totalBalance).length === 0 ? (
              <div className="text-ink-500 text-sm">—</div>
            ) : (
              Object.entries(totalBalance).map(([cur, amount]) => (
                <div key={cur} className="text-2xl font-semibold text-ink-900">
                  {fmt(amount, cur)}
                </div>
              ))
            )}
          </div>
        </Tile>
        <Tile label="Příjmy tento měsíc">
          <div className="text-2xl font-semibold text-emerald-700">
            +{fmt(monthlyStats.income, "CZK")}
          </div>
        </Tile>
        <Tile label="Výdaje tento měsíc">
          <div className="text-2xl font-semibold text-red-700">
            −{fmt(monthlyStats.expense, "CZK")}
          </div>
        </Tile>
      </div>

      {/* Grafy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-ink-900">Top výdaje (tento měsíc)</h2>
            <Link href="/app/statistics" className="text-sm text-brand-600 hover:text-brand-700">
              Detail →
            </Link>
          </div>
          {topExpenseCats.length === 0 ? (
            <div className="py-6 text-center text-ink-500 text-sm">
              Žádné výdaje tento měsíc.
            </div>
          ) : (
            <div className="space-y-3">
              {topExpenseCats.map((row) => (
                <div key={String(row.cid)}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>{row.category?.icon || "📂"}</span>
                      <span className="text-ink-900 truncate">
                        {row.category?.name || "Bez kategorie"}
                      </span>
                    </div>
                    <div className="tabular-nums font-medium text-ink-900">
                      {fmt(row.amount, "CZK")}
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                    <div
                      className="h-full bg-red-500"
                      style={{ width: `${(row.amount / maxExpenseCat) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">6-měsíční trend</h2>
          <div className="flex gap-2 items-end h-40">
            {trend.map((m) => {
              const hIn = (m.income / maxTrend) * 100;
              const hEx = (m.expense / maxTrend) * 100;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex items-end gap-0.5 h-32">
                    <div
                      className="flex-1 bg-emerald-500 rounded-t min-h-[2px]"
                      style={{ height: `${Math.max(hIn, m.income > 0 ? 4 : 0)}%` }}
                      title={`Příjmy: ${fmt(m.income, "CZK")}`}
                    />
                    <div
                      className="flex-1 bg-red-500 rounded-t min-h-[2px]"
                      style={{ height: `${Math.max(hEx, m.expense > 0 ? 4 : 0)}%` }}
                      title={`Výdaje: ${fmt(m.expense, "CZK")}`}
                    />
                  </div>
                  <div className="text-[10px] text-ink-500">
                    {m.month.slice(5)}/{m.month.slice(2, 4)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-emerald-500 rounded" /> Příjmy
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-red-500 rounded" /> Výdaje
            </div>
          </div>
        </section>
      </div>

      {/* Recent transactions */}
      <section className="bg-white rounded-2xl border border-ink-200">
        <div className="px-6 py-4 border-b border-ink-200 flex items-center justify-between">
          <h2 className="font-semibold text-ink-900">Poslední transakce</h2>
          <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
            Všechny →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-ink-500 text-sm">
            Žádné transakce. Napoj banku nebo naskenuj účtenku v mobilu.
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {recent.map((tx) => {
              const cat = tx.categorySyncId ? catMap.get(tx.categorySyncId) : undefined;
              const sign = tx.type === "INCOME" ? "+" : tx.type === "EXPENSE" ? "−" : "";
              return (
                <li key={tx.syncId} className="px-6 py-3 flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full grid place-items-center text-sm ${
                      tx.type === "INCOME"
                        ? "bg-emerald-100 text-emerald-700"
                        : tx.type === "EXPENSE"
                          ? "bg-red-100 text-red-700"
                          : "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {tx.type === "INCOME" ? "↓" : tx.type === "EXPENSE" ? "↑" : "⇄"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink-900 truncate">
                      {tx.description || tx.merchant || "(bez popisu)"}
                    </div>
                    <div className="text-xs text-ink-500 flex items-center gap-2">
                      <span>{formatDate(tx.date)}</span>
                      {cat && (
                        <span className="text-ink-400">
                          · {cat.icon ?? ""} {cat.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      tx.type === "INCOME" ? "text-emerald-700" : "text-ink-900"
                    }`}
                  >
                    {sign}
                    {fmt(tx.amount, tx.currency)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function Loading() {
  return <div className="grid place-items-center py-20 text-ink-500 text-sm">Načítám data…</div>;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
      Chyba: {message}
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

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
