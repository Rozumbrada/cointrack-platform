"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";
import { ServerCategory, ServerTransaction, toUiTransaction } from "@/lib/sync-types";

export default function CategoriesPage() {
  const { loading, error, entitiesByProfile, diagnose, profileSyncId } = useSyncData();
  const categoryEntities = entitiesByProfile<ServerCategory>("categories");
  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const catDiag = diagnose("categories");

  // Map UI tx s typem
  const uiTxs = useMemo(
    () => txEntities.map((e) => toUiTransaction(e.syncId, e.data)),
    [txEntities],
  );

  // Sumy podle category syncId za aktuální měsíc
  const sums = useMemo(() => {
    const monthKey = new Date().toISOString().slice(0, 7);
    const m = new Map<string, { count: number; amount: number }>();
    for (const tx of uiTxs) {
      if (tx.type !== "EXPENSE" && tx.type !== "INCOME") continue;
      if (!tx.date?.startsWith(monthKey)) continue;
      const cid = tx.categorySyncId;
      if (!cid) continue;
      const prev = m.get(cid) ?? { count: 0, amount: 0 };
      m.set(cid, { count: prev.count + 1, amount: prev.amount + tx.amount });
    }
    return m;
  }, [uiTxs]);

  const expense = useMemo(
    () =>
      categoryEntities
        .filter((c) => c.data.type === "EXPENSE")
        .sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categoryEntities],
  );
  const income = useMemo(
    () =>
      categoryEntities
        .filter((c) => c.data.type === "INCOME")
        .sort((a, b) => a.data.name.localeCompare(b.data.name)),
    [categoryEntities],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Kategorie</h1>
        <p className="text-sm text-ink-600 mt-1">
          Kategorie pro příjmy a výdaje. Čísla ukazují aktuální měsíc.
        </p>
      </div>

      <div className="bg-ink-50 border border-ink-200 rounded-xl p-3 text-xs font-mono text-ink-700 space-y-1">
        <div>build: v8-debug · loading={String(loading)} · error={error ?? "null"}</div>
        <div>profileSyncId: {profileSyncId ?? "(žádný)"}</div>
        <div>
          categories: total={catDiag.total} · matched={catDiag.matched} · rendered={categoryEntities.length}
        </div>
        {catDiag.otherProfiles.size > 0 && (
          <div className="break-all">
            jiné profily v kategoriích: {Array.from(catDiag.otherProfiles).join(", ")}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : categoryEntities.length === 0 ? (
        <div className="space-y-3">
          <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
            <div className="text-4xl mb-3">📂</div>
            <div className="font-medium text-ink-900">
              {catDiag.total === 0
                ? "Žádné kategorie v cloudu"
                : "Žádné kategorie pro aktivní profil"}
            </div>
            <p className="text-sm text-ink-600 mt-2">
              {catDiag.total === 0
                ? "Vytvoř první kategorii v mobilní aplikaci a sesynchronizuj cloud."
                : `Máš ${catDiag.total} kategorií celkem, ale žádná není přiřazená k aktuálnímu profilu.`}
            </p>
          </div>
          {catDiag.total > 0 && catDiag.matched === 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 space-y-1">
              <div className="font-medium">Diagnostika:</div>
              {profileSyncId && (
                <div className="font-mono break-all">aktivní profil: {profileSyncId}</div>
              )}
              {catDiag.otherProfiles.size > 0 && (
                <div className="font-mono break-all">
                  profily kategorií: {Array.from(catDiag.otherProfiles).slice(0, 5).join(", ")}
                </div>
              )}
              <div className="text-amber-700 pt-1">
                Možná řešení:
                <ul className="list-disc list-inside mt-1">
                  <li>Přepni profil v sidebaru</li>
                  <li>V mobilu vytvoř kategorii v aktuálním profilu</li>
                  <li>Pokud kategorie patří ke smazanému profilu, byl bug — uděláme bulk re-link později</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CategorySection title="Výdaje" items={expense} sums={sums} colorClass="text-red-700" />
          <CategorySection title="Příjmy" items={income} sums={sums} colorClass="text-emerald-700" />
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
  items: Array<{ syncId: string; data: ServerCategory }>;
  sums: Map<string, { count: number; amount: number }>;
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
            const s = sums.get(c.syncId);
            return (
              <li key={c.syncId} className="px-5 py-3 flex items-center gap-3">
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
