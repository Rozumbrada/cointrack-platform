"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface BudgetData {
  name: string;
  amount: number;
  currency: string;
  period: string;
  categoryId?: number;
  profileId?: number;
}

interface TxData {
  amount: number;
  categoryId?: number;
  type: string;
  dateTime: string;
}

export default function BudgetsPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const budgets = entitiesByProfile<BudgetData>("budgets");
  const txs = entitiesByProfile<TxData>("transactions");

  const spentPerCat = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const m = new Map<number, number>();
    for (const t of txs) {
      if (t.data.type !== "EXPENSE") continue;
      if (!t.data.dateTime?.startsWith(monthKey)) continue;
      if (t.data.categoryId == null) continue;
      m.set(t.data.categoryId, (m.get(t.data.categoryId) ?? 0) + t.data.amount);
    }
    return m;
  }, [txs]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Rozpočty</h1>
        <p className="text-sm text-ink-600 mt-1">
          Měsíční limity výdajů pro aktivní profil.
        </p>
      </div>
      {error && <Err msg={error} />}
      {loading ? (
        <Loading />
      ) : budgets.length === 0 ? (
        <Empty icon="🧮" title="Žádné rozpočty" desc="Vytvoř rozpočet v mobilní aplikaci." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {budgets.map((b) => {
            const spent = b.data.categoryId != null ? spentPerCat.get(b.data.categoryId) ?? 0 : 0;
            const pct = Math.min(100, (spent / b.data.amount) * 100);
            const over = spent > b.data.amount;
            return (
              <div key={b.syncId} className="bg-white rounded-2xl border border-ink-200 p-5">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="font-medium text-ink-900">{b.data.name}</div>
                  <div className="text-xs text-ink-500">{b.data.period}</div>
                </div>
                <div className="text-sm text-ink-600 mb-2 tabular-nums">
                  {fmt(spent, b.data.currency)} / {fmt(b.data.amount, b.data.currency)}
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div
                    className={`h-full ${over ? "bg-red-500" : "bg-brand-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {over && (
                  <div className="text-xs text-red-700 mt-2">
                    Překročeno o {fmt(spent - b.data.amount, b.data.currency)}
                  </div>
                )}
              </div>
            );
          })}
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
function Err({ msg }: { msg: string }) {
  return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">Chyba: {msg}</div>;
}
function Loading() { return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>; }
function Empty({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
      <div className="text-4xl mb-3">{icon}</div>
      <div className="font-medium text-ink-900">{title}</div>
      <p className="text-sm text-ink-600 mt-2">{desc}</p>
    </div>
  );
}
