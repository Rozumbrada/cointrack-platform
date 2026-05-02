"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
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
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date()),
    [locale],
  );
  const { loading, error, entitiesByProfile, rawEntities, reload } = useSyncData();
  const [pickerFor, setPickerFor] = useState<{
    txSyncId: string;
    txType: "INCOME" | "EXPENSE" | "TRANSFER";
    currentCatSyncId?: string;
  } | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const accountEntitiesAll = entitiesByProfile<ServerAccount>("accounts");
  const txEntitiesAll = entitiesByProfile<ServerTransaction>("transactions");
  const categoryEntities = entitiesByProfile<ServerCategory>("categories");

  // ── Account filter ────────────────────────────────────────────────
  // User si může vybrat, které účty se zobrazují v přehledu (totals, tx, stats).
  // Default = všechny ne-Salt-Edge-zombie a ne-excludedFromTotal účty.
  // Selection se persistuje do localStorage per profile (klíč podle URL profilu).

  const eligibleAccounts = useMemo(
    () =>
      accountEntitiesAll.filter((acc) => {
        const d = acc.data as unknown as Record<string, unknown>;
        if (d.bankProvider === "saltedge" || d.externalProvider === "saltedge") {
          const assigned = d.assignedProfileIds as string[] | undefined;
          if (!assigned || assigned.length === 0) return false;
        }
        return true;
      }),
    [accountEntitiesAll],
  );

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string> | null>(null);

  // Default selection: všechny eligible ne-excluded. Inicializuje se až po
  // načtení účtů (loading=true → null state, čeká na data).
  // Cash účty (type=cash, case-insensitive) jsou VŽDY included — odpovídá
  // mobile chování (Hotovost se počítá do total, i v záporu). Před fixem mohl
  // mít web cash účet s `excluded=true` (auto-vytvořený přes ensureCashAccount),
  // takže by se nezahrnul — což matlo uživatele.
  useEffect(() => {
    if (selectedAccountIds !== null) return;
    if (eligibleAccounts.length === 0) return;
    const defaults = new Set<string>();
    for (const acc of eligibleAccounts) {
      const d = acc.data as unknown as Record<string, unknown>;
      const isCash = String(d.type ?? "").toLowerCase() === "cash";
      if (d.excludedFromTotal === true && !isCash) continue;
      defaults.add(acc.syncId);
    }
    setSelectedAccountIds(defaults);
  }, [eligibleAccounts, selectedAccountIds]);

  // Vyfiltrované účty pro výpočty (totals, monthly stats, recent tx, atd.)
  const accountEntities = useMemo(() => {
    if (!selectedAccountIds) return eligibleAccounts; // než dorazí data, počítej se vším
    return eligibleAccounts.filter((a) => selectedAccountIds.has(a.syncId));
  }, [eligibleAccounts, selectedAccountIds]);

  // Filtr transakcí podle vybraných účtů (pro statistiky + recent list)
  const visibleAccountIdSet = useMemo(
    () => new Set(accountEntities.map((a) => a.syncId)),
    [accountEntities],
  );
  const txEntities = useMemo(() => {
    if (visibleAccountIdSet.size === 0) return txEntitiesAll;
    return txEntitiesAll.filter((tx) => {
      const d = tx.data as unknown as Record<string, unknown>;
      const accId = String(d.accountId ?? "");
      // Transfer: pokud target account je vybraný, pusť (bere z toAccountId)
      const toAccId = String(d.toAccountId ?? "");
      return visibleAccountIdSet.has(accId) || (toAccId && visibleAccountIdSet.has(toAccId));
    });
  }, [txEntitiesAll, visibleAccountIdSet]);

  function toggleAccount(syncId: string) {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(syncId)) next.delete(syncId);
      else next.add(syncId);
      return next;
    });
  }

  function selectAllAccounts() {
    setSelectedAccountIds(new Set(eligibleAccounts.map((a) => a.syncId)));
  }

  function clearAccountSelection() {
    setSelectedAccountIds(new Set());
  }

  // First-run detection — bez profilu redirect na onboarding (jednou).
  // FIX (2026-05): pokud má uživatel sdílený profil (recipient pozvánky), neopakuj
  // onboarding — má co používat. Stará podmínka `profiles.length === 0 || accounts === 0`
  // shazovala recipientovi (který nemá VLASTNÍ účet) na onboarding a ten si tam
  // pak omylem vytvořil duplicitní profily.
  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem("cointrack:onboarded") === "1") return;
    const profiles = rawEntities("profiles");
    // Žádný profil vůbec → onboarding (true first-run).
    // Profil je → jsme onboarded, i kdyby byl jen sdílený (= bez vlastních účtů).
    if (profiles.length === 0) {
      router.replace("/onboarding");
    } else {
      localStorage.setItem("cointrack:onboarded", "1");
    }
  }, [loading, rawEntities, router]);

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

  // Celkový zůstatek per měna z vybraných účtů. accountEntities je už filtrované
  // přes selectedAccountIds + eligibleAccounts (nezombie). txEntities pro live
  // balance výpočet — pro každý účet se sečtou tx kterou ten účet má (uvnitř
  // computeAccountBalance se filtruje per accountId).
  const totalBalance = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const acc of accountEntities) {
      // Pro live balance používáme txEntitiesAll — i když účet je vybraný v
      // overview, jeho balance počítáme ze všech jeho tx (selection ovlivňuje
      // kolik účtů sčítáme, ne jak se počítá per-account).
      const live = computeAccountBalance(acc.data, txEntitiesAll, acc.syncId);
      totals[acc.data.currency] = (totals[acc.data.currency] ?? 0) + live;
    }
    return Object.fromEntries(
      Object.entries(totals).filter(([, amount]) => Math.abs(amount) > 0.005),
    );
  }, [accountEntities, txEntitiesAll]);

  // Per-account balance map pro overview cards
  const perAccountBalance = useMemo(() => {
    const m = new Map<string, number>();
    for (const acc of eligibleAccounts) {
      m.set(acc.syncId, computeAccountBalance(acc.data, txEntitiesAll, acc.syncId));
    }
    return m;
  }, [eligibleAccounts, txEntitiesAll]);

  // ─── Period selector ──────────────────────────────────────────────
  // Místo fixního "tento měsíc" si user volí období: měsíc / předchozí /
  // 3 měs / rok / vlastní rozsah. Aplikuje se na příjmy/výdaje, top kategorie
  // a donut. 6-měs trend zůstává nezávisle (samostatná vizualizace).
  type PeriodMode = "currentMonth" | "lastMonth" | "last3Months" | "currentYear" | "custom";
  const [periodMode, setPeriodMode] = useState<PeriodMode>("currentMonth");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  function isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const period = useMemo(() => {
    const now = new Date();
    switch (periodMode) {
      case "currentMonth": {
        const start = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
        const end = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        return { start, end };
      }
      case "lastMonth": {
        const start = isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        const end = isoDate(new Date(now.getFullYear(), now.getMonth(), 0));
        return { start, end };
      }
      case "last3Months": {
        const start = isoDate(new Date(now.getFullYear(), now.getMonth() - 2, 1));
        const end = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        return { start, end };
      }
      case "currentYear": {
        const start = isoDate(new Date(now.getFullYear(), 0, 1));
        const end = isoDate(new Date(now.getFullYear(), 11, 31));
        return { start, end };
      }
      case "custom":
        return {
          start: customFrom || "0000-01-01",
          end: customTo || "9999-12-31",
        };
    }
  }, [periodMode, customFrom, customTo]);

  function inPeriod(date: string | undefined): boolean {
    if (!date) return false;
    const d = date.slice(0, 10); // jen YYYY-MM-DD část
    return d >= period.start && d <= period.end;
  }

  // Příjmy/výdaje za zvolené období
  const periodStats = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of uiTxs) {
      if (!inPeriod(tx.date)) continue;
      if (tx.type === "INCOME") income += tx.amount;
      else if (tx.type === "EXPENSE") expense += tx.amount;
    }
    return { income, expense };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiTxs, period]);

  const periodLabel = useMemo(() => {
    switch (periodMode) {
      case "currentMonth": return monthLabel;
      case "lastMonth": {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return new Intl.DateTimeFormat(locale, { month: "long" }).format(d);
      }
      case "last3Months": return "posledních 3 měs.";
      case "currentYear": return new Date().getFullYear().toString();
      case "custom": return `${period.start} – ${period.end}`;
    }
  }, [periodMode, monthLabel, locale, period]);

  // Posledních 10 transakcí (vždy z celku, period nemění recent list)
  const recent = useMemo(() => {
    return [...uiTxs]
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, 10);
  }, [uiTxs]);

  // Top 5 kategorií výdajů za zvolené období
  const topExpenseCats = useMemo(() => {
    const sums = new Map<string | null, number>();
    for (const tx of uiTxs) {
      if (tx.type !== "EXPENSE") continue;
      if (!inPeriod(tx.date)) continue;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiTxs, catMap, period]);

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

  if (loading) return <div className="grid place-items-center py-20 text-ink-500 text-sm">{t("loading")}</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">{t("error_prefix")} {error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
        <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
      </div>

      {/* Account selector chips — uživatel si volí, které účty se započítávají
          do přehledu, statistik a recent tx. Default = všechny ne-Salt-Edge-zombie
          a ne-excludedFromTotal účty. */}
      {eligibleAccounts.length > 0 && selectedAccountIds && (
        <section className="bg-white rounded-2xl border border-ink-200 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xs font-medium text-ink-500 uppercase tracking-wide">
              Zobrazované účty
            </h2>
            <div className="flex gap-3 text-xs">
              <button
                type="button"
                onClick={selectAllAccounts}
                className="text-brand-600 hover:text-brand-700 font-medium"
              >
                Vybrat vše
              </button>
              <button
                type="button"
                onClick={clearAccountSelection}
                className="text-ink-500 hover:text-ink-700 font-medium"
              >
                Zrušit výběr
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {eligibleAccounts.map((acc) => {
              const isSel = selectedAccountIds.has(acc.syncId);
              const balance = perAccountBalance.get(acc.syncId) ?? 0;
              return (
                <button
                  key={acc.syncId}
                  type="button"
                  onClick={() => toggleAccount(acc.syncId)}
                  className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                    isSel
                      ? "bg-brand-600 border-brand-600 text-white"
                      : "bg-white border-ink-300 text-ink-700 hover:border-ink-400"
                  }`}
                  title={`${acc.data.name} · ${fmt(balance, acc.data.currency)}`}
                >
                  {isSel && <span className="mr-1">✓</span>}
                  {acc.data.name}
                  <span className={`ml-2 tabular-nums ${isSel ? "opacity-90" : "text-ink-500"}`}>
                    {fmt(balance, acc.data.currency)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Období — chips + custom range. Aplikuje se na KPI příjmy/výdaje, top
          výdajové kategorie a donut. 6-měs trend zůstává nezávisle. */}
      <section className="bg-white rounded-2xl border border-ink-200 p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs font-medium text-ink-500 uppercase tracking-wide">
            Období
          </h2>
          <div className="text-xs text-ink-500 tabular-nums">
            {period.start} – {period.end}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["currentMonth", "Tento měsíc"],
            ["lastMonth", "Předchozí měsíc"],
            ["last3Months", "Posledních 3 měsíců"],
            ["currentYear", "Tento rok"],
            ["custom", "Vlastní"],
          ] as Array<[PeriodMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPeriodMode(mode)}
              className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                periodMode === mode
                  ? "bg-brand-600 border-brand-600 text-white"
                  : "bg-white border-ink-300 text-ink-700 hover:border-ink-400"
              }`}
            >
              {periodMode === mode && <span className="mr-1">✓</span>}
              {label}
            </button>
          ))}
        </div>
        {periodMode === "custom" && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-ink-500 mb-1">Od</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-ink-500 mb-1">Do</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm"
              />
            </div>
          </div>
        )}
      </section>

      {/* KPI + trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-ink-200 p-5 space-y-4">
          <div>
            <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
              {t("total_balance")}
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
                {t("income_for_month", { month: periodLabel })}
              </div>
              <div className="text-xl font-semibold text-emerald-700 tabular-nums">
                +{fmt(periodStats.income, "CZK")}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
                {t("expense_for_month", { month: periodLabel })}
              </div>
              <div className="text-xl font-semibold text-red-700 tabular-nums">
                −{fmt(periodStats.expense, "CZK")}
              </div>
            </div>
          </div>

          {/* Per-account overview — list vybraných účtů s živým balance.
              Klik na účet → /app/accounts (zatím; v budoucnu detail stránka). */}
          {accountEntities.length > 0 && (
            <div className="pt-3 border-t border-ink-100">
              <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-2">
                Účty
              </div>
              <div className="space-y-1.5">
                {accountEntities.map((acc) => {
                  const balance = perAccountBalance.get(acc.syncId) ?? 0;
                  return (
                    <Link
                      key={acc.syncId}
                      href="/app/accounts"
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-ink-50 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: colorFromInt(acc.data.color) }}
                        />
                        <span className="text-sm text-ink-900 truncate">{acc.data.name}</span>
                        <span className="text-[10px] uppercase text-ink-500 shrink-0">
                          {labelAccountType(acc.data.type)}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-ink-900 tabular-nums shrink-0">
                        {fmt(balance, acc.data.currency)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">{t("trend_6m")}</h2>
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
                      title={`${t("income")}: ${fmt(m.income, "CZK")}`}
                    />
                    <div
                      className="flex-1 bg-red-500 rounded-t min-h-[2px]"
                      style={{ height: `${Math.max(hEx, m.expense > 0 ? 4 : 0)}%` }}
                      title={`${t("expense")}: ${fmt(m.expense, "CZK")}`}
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
              <div className="w-3 h-3 bg-emerald-500 rounded" /> {t("income")}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 bg-red-500 rounded" /> {t("expense")}
            </div>
          </div>
        </section>
      </div>

      {/* Donut + top výdaje */}
      <section className="bg-white rounded-2xl border border-ink-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-ink-900">{t("expenses_by_category", { month: periodLabel })}</h2>
          <Link href="/app/statistics" className="text-sm text-brand-600 hover:text-brand-700">
            {t("detail")}
          </Link>
        </div>
        {topExpenseCats.length === 0 || periodStats.expense === 0 ? (
          <div className="py-6 text-center text-ink-500 text-sm">
            {t("no_expenses")}
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
                total={periodStats.expense}
                size={200}
                stroke={36}
              />
            </div>
            <div className="space-y-3">
              {topExpenseCats.map((row) => {
                const pct = (row.amount / periodStats.expense) * 100;
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
                          {row.category?.name || t("no_category")}
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
          <h2 className="font-semibold text-ink-900">{t("recent_transactions")}</h2>
          <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
            {t("all_transactions")}
          </Link>
        </div>
        {pickerError && (
          <div className="mx-6 my-3 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
            {pickerError}
          </div>
        )}
        {recent.length === 0 ? (
          <div className="p-8 text-center text-ink-500 text-sm">
            {t("no_transactions")}
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
                    title={t("change_category")}
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
                        {tx.description || tx.merchant || t("no_description")}
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


function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function labelAccountType(type: string | undefined): string {
  // Server data má lowercase typy (Salt Edge / mobile mapping):
  // "cash", "checking", "savings", "credit_card", "investment", "other"
  // Web AccountForm zatím posílá UPPERCASE — handle obojí.
  switch (String(type ?? "").toLowerCase()) {
    case "cash": return "Hotovost";
    case "bank":
    case "checking":
    case "savings": return "Banka";
    case "credit_card":
    case "creditcard": return "Kreditka";
    case "investment": return "Investice";
    default: return type ?? "";
  }
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
