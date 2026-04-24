"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface CategoryData {
  name: string;
  icon?: string;
  color?: number;
  type: "INCOME" | "EXPENSE";
  profileId?: number;
}

interface TxData {
  amount: number;
  categoryId?: number;
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  dateTime: string;
  profileId?: number;
}

export default function CategoriesPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const categories = entitiesByProfile<CategoryData & { id?: number }>("categories");
  const transactions = entitiesByProfile<TxData>("transactions");

  // Spočítej výdaje/příjmy tohoto měsíce per kategorie (přes categoryId)
  const byCategory = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const sums: Record<string, { count: number; amount: number }> = {};
    for (const t of transactions) {
      if (!t.data.dateTime?.startsWith(monthKey)) continue;
      const cid = t.data.categoryId;
      if (cid == null) continue;
      const key = String(cid);
      const prev = sums[key] ?? { count: 0, amount: 0 };
      sums[key] = { count: prev.count + 1, amount: prev.amount + t.data.amount };
    }
    return sums;
  }, [transactions]);

  const income = useMemo(
    () =>
      categories
        .filter((c) => c.data.type === "INCOME")
        .sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categories],
  );
  const expense = useMemo(
    () =>
      categories
        .filter((c) => c.data.type === "EXPENSE")
        .sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categories],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Kategorie</h1>
        <p className="text-sm text-ink-600 mt-1">
          Kategorie pro příjmy a výdaje. Čísla ukazují tento měsíc.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CategorySection
            title="Výdaje"
            items={expense}
            sums={byCategory}
            colorClass="text-red-700"
          />
          <CategorySection
            title="Příjmy"
            items={income}
            sums={byCategory}
            colorClass="text-emerald-700"
          />
        </div>
      )}
    </div>
  );
}

function CategorySection({
  title,
  items,
  sums,
  colorClass,
}: {
  title: string;
  items: Array<{ syncId: string; data: CategoryData & { id?: number } }>;
  sums: Record<string, { count: number; amount: number }>;
  colorClass: string;
}) {
  return (
    <section className="bg-white rounded-2xl border border-ink-200">
      <div className="px-5 py-3 border-b border-ink-200">
        <h2 className="font-semibold text-ink-900">{title}</h2>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-center text-ink-500 text-sm">Žádné kategorie.</div>
      ) : (
        <ul className="divide-y divide-ink-100">
          {items.map((c) => {
            const id = c.data.id ? String(c.data.id) : null;
            const s = id ? sums[id] : undefined;
            return (
              <li
                key={c.syncId}
                className="px-5 py-3 flex items-center gap-3"
              >
                <div
                  className="w-8 h-8 rounded-full grid place-items-center text-sm"
                  style={{ backgroundColor: colorFromInt(c.data.color) }}
                >
                  {c.data.icon || "📂"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink-900 truncate">
                    {c.data.name}
                  </div>
                  {s && (
                    <div className="text-xs text-ink-500">
                      {s.count}× tento měsíc
                    </div>
                  )}
                </div>
                {s && (
                  <div className={`text-sm font-semibold tabular-nums ${colorClass}`}>
                    {fmt(s.amount, "CZK")}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function colorFromInt(c?: number): string {
  if (!c) return "#E5E7EB";
  const n = c >>> 0;
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, 0.2)`;
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}
