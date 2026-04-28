"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerAccount,
  ServerCategory,
  ServerTransaction,
  computeAccountBalance,
  toUiTransaction,
} from "@/lib/sync-types";
import { CategoryIcon, colorFromInt } from "@/components/app/CategoryIcon";
import { CategoryPicker } from "@/components/app/CategoryPicker";
import { ExpenseDonut, categoryColor } from "@/components/app/ExpenseDonut";

export default function DashboardPage() {
  const router = useRouter();
  const { loading, error, entitiesByProfile, rawEntities, reload } = useSyncData();
  const [pickerFor, setPickerFor] = useState<{
    txSyncId: string;
    txType: "INCOME" | "EXPENSE" | "TRANSFER";
    currentCatSyncId?: string;
  } | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const accountEntities = entitiesByProfile<ServerAccount>("accounts");
  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const categoryEntities = entitiesByProfile<ServerCategory>("categories");

  // First-run detection — bez profilu/účtu redirect na onboarding (jednou)
  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem("cointrack:onboarded") === "1") return;
    const profiles = rawEntities("profiles");
    if (profiles.length === 0 || accountEntities.length === 0) {
      router.replace("/onboarding");
    } else {
      localStorage.setItem("cointrack:onboarded", "1");
    }
  }, [loading, rawEntities, accountEntities.length, router]);

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

  // Celkový zůstatek per měna.
  //
  // Pravidla:
  //  • účet musí mít includeInTotal/!excludedFromTotal
  //  • Salt Edge účty bez profile assignmentu jsou ignorovány (auto-importované
  //    do dávno smazaných profilů zůstaly v cloudu jako "zombie")
  //  • Nulový součet měny se neukazuje (zbavuje UI artefaktů smazaných účtů)
  const totalBalance = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const acc of accountEntities) {
      const d = acc.data as unknown as Record<string, unknown>;
      if (d.excludedFromTotal === true) continue;
      // Salt Edge účet bez assignmentu = zombie data, ignoruj
      if (d.bankProvider === "saltedge" || d.externalProvider === "saltedge") {
        const assigned = d.assignedProfileIds as string[] | undefined;
        if (!assigned || assigned.length === 0) continue;
      }
      const live = computeAccountBalance(acc.data, txEntities, acc.syncId);
      totals[acc.data.currency] = (totals[acc.data.currency] ?? 0) + live;
    }
    return Object.fromEntries(
      Object.entries(totals).filter(([, amount]) => Math.abs(amount) > 0.005),
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

  const maxTrend = Math.max(...trend.flatMap((m) => [m.income, m.expense]), 1);

  async function setCategory(txSyncId: string, newCatSyncId: string | null) {
    const target = txEntities.find((t) => t.syncId === txSyncId);
    if (!target) return;
    setPickerError(null);
    try {
      const now = new Date().toISOString();
      const merged: ServerTransaction = {
        ...target.data,
        categoryId: newCatSyncId ?? undefined,
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            transactions: [
              {
                syncId: target.syncId,
                updatedAt: now,
                clientVersion: 1,
                data: merged as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      await reload();
    } catch (e) {
      setPickerError(e instanceof Error ? e.message : String(e));
    }
  }

  const allCats = categoryEntities;

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

      {/* KPI + 6-měsíční trend bok po boku */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-ink-200 p-5 space-y-4">
          <div>
            <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
              Celkový zůstatek
            </div>
            <div className="space-y-0.5">
              {Object.entries(totalBalance).length === 0 ? (
                <div className="text-ink-500 text-sm">—</div>
              ) : (
                Object.entries(totalBalance).map(([cur, amount]) => (
                  <div key={cur} className="text-3xl font-semibold text-ink-900 tabular-nums">
                    {fmt(amount, cur)}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-ink-100">
            <div>
              <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
                Příjmy ({monthLabel()})
              </div>
              <div className="text-xl font-semibold text-emerald-700 tabular-nums">
                +{fmt(monthlyStats.income, "CZK")}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
                Výdaje ({monthLabel()})
              </div>
              <div className="text-xl font-semibold text-red-700 tabular-nums">
                −{fmt(monthlyStats.expense, "CZK")}
              </div>
            </div>
          </div>
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

      {/* Donut + top výdaje */}
      <section className="bg-white rounded-2xl border border-ink-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-ink-900">Výdaje podle kategorií ({monthLabel()})</h2>
          <Link href="/app/statistics" className="text-sm text-brand-600 hover:text-brand-700">
            Detail →
          </Link>
        </div>
        {topExpenseCats.length === 0 || monthlyStats.expense === 0 ? (
          <div className="py-6 text-center text-ink-500 text-sm">
            Žádné výdaje tento měsíc.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            <div className="flex justify-center">
              <ExpenseDonut
                segments={topExpenseCats.map((c) => ({
                  cid: String(c.cid),
                  amount: c.amount,
                  category: c.category,
                }))}
                total={monthlyStats.expense}
                size={200}
                stroke={36}
              />
            </div>
            <div className="space-y-3">
              {topExpenseCats.map((row) => {
                const pct = (row.amount / monthlyStats.expense) * 100;
                return (
                  <div key={String(row.cid)}>
                    <div className="flex items-center justify-between text-sm mb-1 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{
                            backgroundColor: categoryColor(row.category, String(row.cid)),
                          }}
                        />
                        {row.category?.icon && <CategoryIcon name={row.category.icon} size="sm" />}
                        <span className="text-ink-900 truncate">
                          {row.category?.name || "Bez kategorie"}
                        </span>
                      </div>
                      <div className="tabular-nums font-medium text-ink-900 shrink-0">
                        {fmt(row.amount, "CZK")}
                      </div>
                    </div>
                    <div className="text-[10px] text-ink-500 tabular-nums text-right">
                      {pct.toFixed(0)} %
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Recent transactions */}
      <section className="bg-white rounded-2xl border border-ink-200">
        <div className="px-6 py-4 border-b border-ink-200 flex items-center justify-between">
          <h2 className="font-semibold text-ink-900">Poslední transakce</h2>
          <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
            Všechny →
          </Link>
        </div>
        {pickerError && (
          <div className="mx-6 my-3 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
            {pickerError}
          </div>
        )}
        {recent.length === 0 ? (
          <div className="p-8 text-center text-ink-500 text-sm">
            Žádné transakce. Napoj banku nebo naskenuj účtenku v mobilu.
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {recent.map((tx) => {
              const cat = tx.categorySyncId ? catMap.get(tx.categorySyncId) : undefined;
              const sign = tx.type === "INCOME" ? "+" : tx.type === "EXPENSE" ? "−" : "";
              const fallbackBg =
                tx.type === "INCOME"
                  ? "rgba(16, 185, 129, 0.15)"
                  : tx.type === "EXPENSE"
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(99, 102, 241, 0.15)";
              return (
                <li key={tx.syncId} className="px-6 py-3 flex items-center gap-3 hover:bg-ink-50/50">
                  <button
                    onClick={() =>
                      setPickerFor({
                        txSyncId: tx.syncId,
                        txType: tx.type,
                        currentCatSyncId: tx.categorySyncId,
                      })
                    }
                    title="Změnit kategorii"
                    disabled={tx.type === "TRANSFER"}
                    className="w-9 h-9 rounded-full grid place-items-center shrink-0 hover:ring-2 hover:ring-brand-500/40 transition-all disabled:opacity-60 disabled:cursor-default"
                    style={{
                      backgroundColor: cat ? colorFromInt(cat.color) : fallbackBg,
                    }}
                  >
                    {cat ? (
                      <CategoryIcon name={cat.icon} />
                    ) : (
                      <span className="text-sm">
                        {tx.type === "INCOME" ? "↓" : tx.type === "EXPENSE" ? "↑" : "⇄"}
                      </span>
                    )}
                  </button>
                  <Link
                    href={`/app/transactions/${tx.syncId}`}
                    className="flex-1 min-w-0 flex items-center gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink-900 truncate">
                        {tx.description || tx.merchant || "(bez popisu)"}
                      </div>
                      <div className="text-xs text-ink-500 flex items-center gap-2">
                        <span>{formatDate(tx.date)}</span>
                        {cat && <span className="text-ink-400 truncate">· {cat.name}</span>}
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
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {pickerFor && (
        <CategoryPicker
          allCategories={allCats}
          currentSyncId={pickerFor.currentCatSyncId}
          txType={pickerFor.txType}
          onClose={() => setPickerFor(null)}
          onSelect={async (catSyncId) => {
            const target = pickerFor;
            setPickerFor(null);
            await setCategory(target.txSyncId, catSyncId);
          }}
        />
      )}
    </div>
  );
}

function monthLabel(): string {
  return new Intl.DateTimeFormat("cs-CZ", { month: "long" }).format(new Date());
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
