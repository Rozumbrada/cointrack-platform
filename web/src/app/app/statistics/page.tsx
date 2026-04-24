"use client";

import { useMemo, useState } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface CategoryData {
  id?: number;
  name: string;
  icon?: string;
  color?: number;
  type: "INCOME" | "EXPENSE";
}

interface TxData {
  amount: number;
  categoryId?: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  dateTime: string;
}

export default function StatisticsPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const [period, setPeriod] = useState<"month" | "year">("month");

  const categories = entitiesByProfile<CategoryData>("categories");
  const transactions = entitiesByProfile<TxData>("transactions");

  const catMap = useMemo(() => {
    const m = new Map<number, CategoryData>();
    categories.forEach((c) => c.data.id && m.set(c.data.id, c.data));
    return m;
  }, [categories]);

  const dateFrom = useMemo(() => {
    const d = new Date();
    if (period === "month") d.setDate(1);
    else d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [period]);

  const { expenseByCategory, incomeTotal, expenseTotal, monthlyTrend } = useMemo(() => {
    const expCat = new Map<number | null, number>();
    let income = 0;
    let expense = 0;
    const byMonth = new Map<string, { income: number; expense: number }>();

    for (const t of transactions) {
      if (!t.data.dateTime) continue;
      const ym = t.data.dateTime.slice(0, 7);
      const bucket = byMonth.get(ym) ?? { income: 0, expense: 0 };
      if (t.data.type === "INCOME") bucket.income += t.data.amount;
      else if (t.data.type === "EXPENSE") bucket.expense += t.data.amount;
      byMonth.set(ym, bucket);

      if (t.data.dateTime < dateFrom) continue;

      if (t.data.type === "INCOME") income += t.data.amount;
      else if (t.data.type === "EXPENSE") {
        expense += t.data.amount;
        const cid = t.data.categoryId ?? null;
        expCat.set(cid, (expCat.get(cid) ?? 0) + t.data.amount);
      }
    }

    const sortedExpenseCat = Array.from(expCat.entries())
      .map(([cid, amount]) => ({ cid, amount, category: cid != null ? catMap.get(cid) : undefined }))
      .sort((a, b) => b.amount - a.amount);

    // Trend — posledních 6 měsíců
    const trend: Array<{ month: string; income: number; expense: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = byMonth.get(ym) ?? { income: 0, expense: 0 };
      trend.push({ month: ym, income: b.income, expense: b.expense });
    }

    return {
      expenseByCategory: sortedExpenseCat,
      incomeTotal: income,
      expenseTotal: expense,
      monthlyTrend: trend,
    };
  }, [transactions, catMap, dateFrom]);

  const maxExpenseCat = expenseByCategory[0]?.amount ?? 1;
  const maxMonthly = Math.max(
    ...monthlyTrend.flatMap((m) => [m.income, m.expense]),
    1,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Statistiky</h1>
          <p className="text-sm text-ink-600 mt-1">
            Přehled výdajů podle kategorií + 6-měsíční trend.
          </p>
        </div>
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm self-start">
          {(["month", "year"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 ${
                period === p ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {p === "month" ? "Tento měsíc" : "Tento rok"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryTile
              label="Příjmy"
              amount={incomeTotal}
              className="text-emerald-700"
            />
            <SummaryTile
              label="Výdaje"
              amount={expenseTotal}
              className="text-red-700"
            />
            <SummaryTile
              label="Bilance"
              amount={incomeTotal - expenseTotal}
              className={
                incomeTotal - expenseTotal >= 0 ? "text-emerald-700" : "text-red-700"
              }
            />
          </div>

          {/* Výdaje po kategoriích */}
          <section className="bg-white rounded-2xl border border-ink-200 p-6">
            <h2 className="font-semibold text-ink-900 mb-4">
              Výdaje podle kategorií
            </h2>
            {expenseByCategory.length === 0 ? (
              <div className="text-sm text-ink-500 text-center py-8">
                Žádné výdaje v tomto období.
              </div>
            ) : (
              <div className="space-y-3">
                {expenseByCategory.map((row) => (
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
                        style={{
                          width: `${(row.amount / maxExpenseCat) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Měsíční trend */}
          <section className="bg-white rounded-2xl border border-ink-200 p-6">
            <h2 className="font-semibold text-ink-900 mb-4">Měsíční trend</h2>
            <div className="flex gap-2 items-end h-48">
              {monthlyTrend.map((m) => {
                const hIn = (m.income / maxMonthly) * 100;
                const hEx = (m.expense / maxMonthly) * 100;
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex items-end gap-0.5 h-40">
                      <div
                        className="flex-1 bg-emerald-500 rounded-t"
                        style={{ height: `${hIn}%` }}
                        title={`Příjmy: ${fmt(m.income, "CZK")}`}
                      />
                      <div
                        className="flex-1 bg-red-500 rounded-t"
                        style={{ height: `${hEx}%` }}
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
        </>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  amount,
  className,
}: {
  label: string;
  amount: number;
  className: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${className}`}>
        {fmt(amount, "CZK")}
      </div>
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
