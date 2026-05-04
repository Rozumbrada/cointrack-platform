"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerAccount,
  ServerCategory,
  ServerTransaction,
  toUiTransaction,
  UiTransaction,
} from "@/lib/sync-types";

/**
 * Server Budget shape — sjednocený s budgets/page.tsx pro statistiky.
 * `limit` je string (server konvence pro decimal).
 */
interface ServerBudget {
  profileId: string;
  categoryId?: string;
  name: string;
  limit: string;
  period: string;
  currency: string;
}
import {
  Period,
  PeriodSelector,
  periodRange,
} from "@/components/app/PeriodSelector";
import { CategoryIcon } from "@/components/app/CategoryIcon";
import { ExpenseDonut, categoryColor } from "@/components/app/ExpenseDonut";
import { ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";

export default function StatisticsPage() {
  const t = useTranslations("statistics_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile } = useSyncData();
  const [period, setPeriod] = useState<Period>("30d");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  /**
   * Filter dle účtů — multi-select. Empty = všechny účty (default). Stejný
   * pattern jako mobile StatisticsScreen + dashboard. Persistuje se v paměti
   * (resetuje při navigaci pryč).
   */
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());

  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const categoryEntities = entitiesByProfile<ServerCategory>("categories");
  const accountEntities = entitiesByProfile<ServerAccount>("accounts");
  const budgetEntities = entitiesByProfile<ServerBudget>("budgets");

  const catMap = useMemo(() => {
    const m = new Map<string, ServerCategory>();
    categoryEntities.forEach((c) => m.set(c.syncId, c.data));
    return m;
  }, [categoryEntities]);

  const uiTxs = useMemo(
    () => txEntities.map((e) => toUiTransaction(e.syncId, e.data)),
    [txEntities],
  );

  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);

  const inPeriod = useMemo(() => {
    return uiTxs.filter((tx) => {
      if (range.from && tx.date < range.from) return false;
      if (range.to && tx.date > range.to) return false;
      // Account filter — empty set = všechny účty pusť
      if (selectedAccountIds.size > 0) {
        if (!tx.accountSyncId) return false;
        if (!selectedAccountIds.has(tx.accountSyncId)) return false;
      }
      return true;
    });
  }, [uiTxs, range, selectedAccountIds]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of inPeriod) {
      if (tx.type === "INCOME") income += tx.amount;
      else if (tx.type === "EXPENSE") expense += tx.amount;
    }
    return { income, expense, net: income - expense };
  }, [inPeriod]);

  /**
   * Savings rate = (income − expense) / income, ve %. Null pokud income=0
   * (rate je nedefinovaný). Klíčový ukazatel finančního zdraví.
   */
  const savingsRate = useMemo(() => {
    if (totals.income <= 0) return null;
    return ((totals.income - totals.expense) / totals.income) * 100;
  }, [totals]);

  /**
   * Period-over-period comparison. Bere stejně dlouhé období BEZPROSTŘEDNĚ
   * před aktuálním (např. aktuální 30D zpět vs předchozích 30D).
   *
   * Používá `range` z PeriodSelector (může být custom). Pokud range nemá
   * `from` (= žádný start), vrací null (např. pro all-time period).
   */
  const previousPeriodComparison = useMemo(() => {
    if (!range.from || !range.to) return null;
    const fromDate = new Date(range.from);
    const toDate = new Date(range.to);
    const periodMs = toDate.getTime() - fromDate.getTime();
    if (periodMs <= 0) return null;
    const prevTo = new Date(fromDate.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - periodMs);
    const prevToStr = prevTo.toISOString().slice(0, 10);
    const prevFromStr = prevFrom.toISOString().slice(0, 10);
    let prevIncome = 0;
    let prevExpense = 0;
    for (const tx of uiTxs) {
      if (tx.date < prevFromStr || tx.date > prevToStr) continue;
      if (selectedAccountIds.size > 0) {
        if (!tx.accountSyncId || !selectedAccountIds.has(tx.accountSyncId)) continue;
      }
      if (tx.type === "INCOME") prevIncome += tx.amount;
      else if (tx.type === "EXPENSE") prevExpense += tx.amount;
    }
    const expensePct = prevExpense > 0 ? ((totals.expense - prevExpense) / prevExpense) * 100 : null;
    const incomePct = prevIncome > 0 ? ((totals.income - prevIncome) / prevIncome) * 100 : null;
    return { prevIncome, prevExpense, expensePct, incomePct };
  }, [range, uiTxs, selectedAccountIds, totals]);

  /**
   * Top 10 obchodníků/protistran dle součtu výdajů. Sjednocuje:
   *   - merchant (web doc dialog)
   *   - description (Cointrack manual / Fio import často píše do description
   *     nazevProtiuctu nebo merchant name)
   * Normalizuje (trim, max 60) a sčítá.
   */
  const topMerchants = useMemo(() => {
    const sums = new Map<string, { amount: number; count: number }>();
    for (const tx of inPeriod) {
      if (tx.type !== "EXPENSE") continue;
      const raw = tx.merchant?.trim() || tx.description?.trim() || "(neznámý)";
      const name = raw.replace(/\s+/g, " ").slice(0, 60);
      const cur = sums.get(name) ?? { amount: 0, count: 0 };
      cur.amount += tx.amount;
      cur.count += 1;
      sums.set(name, cur);
    }
    return Array.from(sums.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [inPeriod]);

  /**
   * Budget vs Actual progress per kategorii. Pokud rozpočet má kategorii,
   * sčítá jen výdaje z dané kategorie; jinak všechny výdaje období.
   */
  const budgetProgress = useMemo(() => {
    if (budgetEntities.length === 0) return [];
    return budgetEntities
      .map((b) => {
        const limit = parseFloat(b.data.limit) || 0;
        const matching = inPeriod.filter(
          (tx) =>
            tx.type === "EXPENSE" &&
            (!b.data.categoryId || tx.categorySyncId === b.data.categoryId),
        );
        // Skip uncategorized rozpočet pokud žádné tx
        if (matching.length === 0 && b.data.categoryId) return null;
        const spent = matching.reduce((s, tx) => s + tx.amount, 0);
        const cat = b.data.categoryId ? catMap.get(b.data.categoryId) : undefined;
        return {
          name: b.data.name,
          category: cat,
          limit,
          spent,
          percent: limit > 0 ? (spent / limit) * 100 : 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.percent - a.percent);
  }, [budgetEntities, inPeriod, catMap]);

  /**
   * Heuristická detekce pravidelných plateb (předplatné, nájem, splátky).
   * Stejná logika jako mobile StatisticsViewModel.recurringPayments.
   * Bere posledních 180 dní z uiTxs (bez ohledu na filter), respektuje
   * jen account filter.
   */
  const recurringPayments = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 180);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const candidates = uiTxs.filter((tx) => {
      if (tx.type !== "EXPENSE") return false;
      if (tx.date < cutoffStr) return false;
      if (selectedAccountIds.size > 0) {
        if (!tx.accountSyncId || !selectedAccountIds.has(tx.accountSyncId)) return false;
      }
      return true;
    });
    const byMerchant = new Map<string, UiTransaction[]>();
    for (const tx of candidates) {
      const raw = tx.merchant?.trim() || tx.description?.trim();
      if (!raw) continue;
      const key = raw.replace(/\s+/g, " ").slice(0, 60).toLowerCase();
      if (!byMerchant.has(key)) byMerchant.set(key, []);
      byMerchant.get(key)!.push(tx);
    }
    const result: Array<{
      merchant: string;
      avgAmount: number;
      occurrences: number;
      frequency: string;
      lastDate: string;
    }> = [];
    byMerchant.forEach((group) => {
      if (group.length < 3) return;
      const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
      // Median interval (days) mezi consecutive
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const a = new Date(sorted[i - 1].date);
        const b = new Date(sorted[i].date);
        intervals.push(Math.round((b.getTime() - a.getTime()) / 86400000));
      }
      if (intervals.length === 0) return;
      const sortedInt = [...intervals].sort((a, b) => a - b);
      const median = sortedInt[Math.floor(sortedInt.length / 2)];
      let frequency: string;
      if (median >= 5 && median <= 9) frequency = "weekly";
      else if (median >= 12 && median <= 16) frequency = "biweekly";
      else if (median >= 25 && median <= 35) frequency = "monthly";
      else if (median >= 80 && median <= 100) frequency = "quarterly";
      else return; // nepravidelné

      const amounts = sorted.map((t) => t.amount);
      const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / amounts.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? stdDev / mean : Infinity;
      if (cv > 0.20) return; // moc kolísá

      const displayName =
        sorted[0].merchant?.trim() || sorted[0].description?.trim() || "(neznámý)";
      result.push({
        merchant: displayName.replace(/\s+/g, " ").slice(0, 60),
        avgAmount: mean,
        occurrences: sorted.length,
        frequency,
        lastDate: sorted[sorted.length - 1].date,
      });
    });
    return result.sort((a, b) => b.occurrences - a.occurrences).slice(0, 20);
  }, [uiTxs, selectedAccountIds]);

  /**
   * Cashflow line — kumulativní zůstatek od počátku období.
   * Starting balance = signed sum všech tx před period.from (account-filtered).
   */
  const cashflow = useMemo(() => {
    if (!range.from || !range.to) return [];
    const fromStr = range.from;
    const toStr = range.to;
    // Filter helper
    const passes = (tx: UiTransaction): boolean => {
      if (selectedAccountIds.size === 0) return true;
      return !!tx.accountSyncId && selectedAccountIds.has(tx.accountSyncId);
    };
    const signedDelta = (tx: UiTransaction): number => {
      if (tx.type === "INCOME") return tx.amount;
      if (tx.type === "EXPENSE") return -tx.amount;
      return 0; // TRANSFER nemění total
    };
    let startingBalance = 0;
    for (const tx of uiTxs) {
      if (!passes(tx)) continue;
      if (tx.date < fromStr) startingBalance += signedDelta(tx);
    }
    // Group per den
    const perDay = new Map<string, number>();
    for (const tx of uiTxs) {
      if (!passes(tx)) continue;
      if (tx.date < fromStr || tx.date > toStr) continue;
      perDay.set(tx.date, (perDay.get(tx.date) ?? 0) + signedDelta(tx));
    }
    const fromDate = new Date(fromStr);
    const toDate = new Date(toStr);
    const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
    const granularity: "day" | "week" | "month" =
      days <= 31 ? "day" : days <= 120 ? "week" : "month";

    const points: { label: string; balance: number }[] = [];
    let running = startingBalance;
    if (granularity === "day") {
      const cur = new Date(fromDate);
      while (cur <= toDate) {
        const key = cur.toISOString().slice(0, 10);
        running += perDay.get(key) ?? 0;
        points.push({
          label: `${cur.getDate()}.${cur.getMonth() + 1}.`,
          balance: running,
        });
        cur.setDate(cur.getDate() + 1);
      }
    } else if (granularity === "week") {
      const cur = new Date(fromDate);
      // Move to Monday
      const dayOfWeek = cur.getDay() || 7;
      cur.setDate(cur.getDate() - dayOfWeek + 1);
      while (cur <= toDate) {
        let weekSum = 0;
        for (let i = 0; i < 7; i++) {
          const d = new Date(cur);
          d.setDate(d.getDate() + i);
          const key = d.toISOString().slice(0, 10);
          weekSum += perDay.get(key) ?? 0;
        }
        running += weekSum;
        points.push({
          label: `${cur.getDate()}.${cur.getMonth() + 1}.`,
          balance: running,
        });
        cur.setDate(cur.getDate() + 7);
      }
    } else {
      const cur = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
      while (cur <= toDate) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        let monthSum = 0;
        for (const [key, val] of perDay.entries()) {
          const d = new Date(key);
          if (d >= cur && d < next) monthSum += val;
        }
        running += monthSum;
        const labels = ["Led", "Úno", "Bře", "Dub", "Kvě", "Čvn", "Čvc", "Srp", "Zář", "Říj", "Lis", "Pro"];
        points.push({
          label: labels[cur.getMonth()],
          balance: running,
        });
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    return points;
  }, [uiTxs, range, selectedAccountIds]);

  // Kategorie pro výdaje
  const categoryStats = useMemo(() => {
    const sums = new Map<string, number>();
    for (const tx of inPeriod) {
      if (tx.type !== "EXPENSE") continue;
      const cid = tx.categorySyncId ?? "__uncategorized__";
      sums.set(cid, (sums.get(cid) ?? 0) + tx.amount);
    }
    const arr = Array.from(sums.entries())
      .map(([cid, amount]) => ({
        cid,
        amount,
        category: cid !== "__uncategorized__" ? catMap.get(cid) : undefined,
      }))
      .sort((a, b) => b.amount - a.amount);
    return arr;
  }, [inPeriod, catMap]);

  const visibleCategoryStats = categoryStats.filter((c) => !hiddenCategories.has(c.cid));
  const totalVisibleExpense = visibleCategoryStats.reduce((s, c) => s + c.amount, 0);

  // Bar chart data — agreguj podle časového úseku
  const trend = useMemo(() => buildTrend(inPeriod, period), [inPeriod, period]);
  const maxBar = Math.max(...trend.flatMap((b) => [b.income, b.expense]), 1);

  function toggleCategory(cid: string) {
    const next = new Set(hiddenCategories);
    if (next.has(cid)) next.delete(cid);
    else next.add(cid);
    setHiddenCategories(next);
  }

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        {t("error_prefix")} {error}
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        <PeriodSelector
          period={period}
          onChange={setPeriod}
          custom={customRange}
          onCustomChange={setCustomRange}
        />
      </div>

      {/* Account filter — multi-select chips. Empty = všechny účty.
          Stejný UX pattern jako Dashboard a TransactionsScreen v mobile,
          aby user měl konzistentní filtrování napříč obrazovkami. */}
      {accountEntities.length > 1 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-xs font-medium text-ink-500 uppercase tracking-wide">
              Filtrované účty
            </h2>
            {selectedAccountIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedAccountIds(new Set())}
                className="text-xs text-ink-500 hover:text-ink-700 font-medium"
              >
                Vybrat vše
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {accountEntities.map((acc) => {
              const isSel = selectedAccountIds.has(acc.syncId);
              return (
                <button
                  key={acc.syncId}
                  type="button"
                  onClick={() => {
                    setSelectedAccountIds((prev) => {
                      const n = new Set(prev);
                      if (n.has(acc.syncId)) n.delete(acc.syncId);
                      else n.add(acc.syncId);
                      return n;
                    });
                  }}
                  className={`px-3 py-1.5 rounded-full border text-xs transition-colors ${
                    isSel
                      ? "bg-brand-600 border-brand-600 text-white"
                      : "bg-white border-ink-300 text-ink-700 hover:border-ink-400"
                  }`}
                  title={`${acc.data.name} (${acc.data.currency})`}
                >
                  {isSel && <span className="mr-1">✓</span>}
                  {acc.data.name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile label={t("income")} amount={totals.income} color="text-emerald-700" sign="+" locale={locale} />
        <Tile label={t("expense")} amount={totals.expense} color="text-red-700" sign="−" locale={locale} />
        <Tile
          label={t("balance")}
          amount={totals.net}
          color={totals.net >= 0 ? "text-emerald-700" : "text-red-700"}
          sign={totals.net >= 0 ? "+" : "−"}
          absoluteAmount
          locale={locale}
        />
      </div>

      {/* Insight chips: savings rate + period-over-period comparison.
          Sjednocené s mobile StatisticsScreen (V35). */}
      <div className="flex flex-wrap gap-3">
        {savingsRate !== null && (
          <InsightChip
            label="Míra spoření"
            value={`${savingsRate.toFixed(0)} %`}
            isPositive={savingsRate >= 10}
          />
        )}
        {previousPeriodComparison?.expensePct !== null &&
          previousPeriodComparison?.expensePct !== undefined && (
            <InsightChip
              label="Výdaje vs předchozí"
              value={`${previousPeriodComparison.expensePct >= 0 ? "+" : ""}${previousPeriodComparison.expensePct.toFixed(0)} %`}
              isPositive={previousPeriodComparison.expensePct < 0}
            />
          )}
        {previousPeriodComparison?.incomePct !== null &&
          previousPeriodComparison?.incomePct !== undefined && (
            <InsightChip
              label="Příjmy vs předchozí"
              value={`${previousPeriodComparison.incomePct >= 0 ? "+" : ""}${previousPeriodComparison.incomePct.toFixed(0)} %`}
              isPositive={previousPeriodComparison.incomePct > 0}
            />
          )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut + legend */}
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">{t("expenses_by_category")}</h2>
          {visibleCategoryStats.length === 0 ? (
            <div className="py-12 text-center text-ink-500 text-sm">
              {t("no_expenses_in_period")}
            </div>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <ExpenseDonut segments={visibleCategoryStats.slice(0, 8)} total={totalVisibleExpense} />
              </div>
              <ul className="space-y-1 max-h-96 overflow-y-auto">
                {categoryStats.map((c) => {
                  const isHidden = hiddenCategories.has(c.cid);
                  const isExpanded = expandedCategory === c.cid;
                  const pct = totalVisibleExpense > 0 && !isHidden
                    ? (c.amount / totalVisibleExpense) * 100
                    : 0;
                  const catTxs = isExpanded
                    ? inPeriod
                        .filter(
                          (tx) =>
                            tx.type === "EXPENSE" &&
                            (tx.categorySyncId ?? "__uncategorized__") === c.cid,
                        )
                        .sort((a, b) => b.date.localeCompare(a.date))
                    : [];
                  return (
                    <li key={c.cid}>
                      <div
                        className={`flex items-center gap-3 text-sm cursor-pointer rounded-md px-2 py-1.5 hover:bg-ink-50 ${
                          isHidden ? "opacity-40" : ""
                        } ${isExpanded ? "bg-ink-50" : ""}`}
                        onClick={() =>
                          setExpandedCategory(isExpanded ? null : c.cid)
                        }
                      >
                        {/* Větší expand-arrow s plynulou animací rotace */}
                        <span
                          className="text-ink-500 shrink-0 transition-transform"
                          aria-hidden="true"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5" />
                          ) : (
                            <ChevronRight className="w-5 h-5" />
                          )}
                        </span>
                        <div
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{
                            backgroundColor: categoryColor(c.category, c.cid),
                          }}
                        />
                        {c.category?.icon && (
                          <CategoryIcon name={c.category.icon} size="sm" />
                        )}
                        <div className="flex-1 min-w-0 truncate">
                          {c.category?.name ?? t("no_category")}
                        </div>
                        <div className="text-xs text-ink-500 tabular-nums">
                          {pct.toFixed(0)} %
                        </div>
                        <div className="font-medium tabular-nums w-24 text-right">
                          {fmt(c.amount, "CZK", locale)}
                        </div>
                        {/* Visibility toggle — výchozí (viditelné) je otevřené oko,
                            kliknutím se kategorie skryje (zavřené oko + opacity řádku). */}
                        <button
                          className={`shrink-0 p-1 rounded hover:bg-ink-100 transition-colors ${
                            isHidden ? "text-ink-400" : "text-ink-600 hover:text-ink-900"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategory(c.cid);
                          }}
                          title={isHidden ? t("show_in_chart") : t("hide_from_chart")}
                          aria-label={isHidden ? t("show_in_chart") : t("hide_from_chart")}
                        >
                          {isHidden ? (
                            <EyeOff className="w-5 h-5" />
                          ) : (
                            <Eye className="w-5 h-5" />
                          )}
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="ml-6 mt-1 mb-2 border-l-2 border-ink-200 pl-3 space-y-1">
                          {catTxs.length === 0 ? (
                            <div className="text-xs text-ink-500 py-2">
                              {t("no_transactions_short")}
                            </div>
                          ) : (
                            catTxs.map((tx) => (
                              <Link
                                key={tx.syncId}
                                href={`/app/transactions/${tx.syncId}`}
                                className="flex items-center gap-2 text-xs py-1.5 hover:bg-ink-100 rounded px-2 -ml-2"
                              >
                                <span className="text-ink-500 tabular-nums shrink-0">
                                  {formatDate(tx.date, locale)}
                                </span>
                                <span className="flex-1 min-w-0 truncate text-ink-900">
                                  {tx.description || tx.merchant || t("no_description")}
                                </span>
                                <span className="font-medium tabular-nums">
                                  {fmt(tx.amount, tx.currency, locale)}
                                </span>
                              </Link>
                            ))
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* Bar chart trend */}
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">{t("trend")}</h2>
          {trend.length === 0 ? (
            <div className="py-12 text-center text-ink-500 text-sm">
              {t("no_data")}
            </div>
          ) : (
            <>
              <div className="flex gap-1 items-end h-48">
                {trend.map((b) => {
                  const hIn = (b.income / maxBar) * 100;
                  const hEx = (b.expense / maxBar) * 100;
                  return (
                    <div key={b.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div className="w-full flex items-end gap-px h-40">
                        <div
                          className="flex-1 bg-emerald-500 rounded-t"
                          style={{ height: `${Math.max(hIn, b.income > 0 ? 3 : 0)}%` }}
                          title={`${t("income")}: ${fmt(b.income, "CZK", locale)}`}
                        />
                        <div
                          className="flex-1 bg-red-500 rounded-t"
                          style={{ height: `${Math.max(hEx, b.expense > 0 ? 3 : 0)}%` }}
                          title={`${t("expense")}: ${fmt(b.expense, "CZK", locale)}`}
                        />
                      </div>
                      <div className="text-[9px] text-ink-500 truncate w-full text-center">
                        {b.label}
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
            </>
          )}
        </section>
      </div>

      {/* Cashflow line — kumulativní zůstatek v čase. V36: sjednoceno
          s mobile StatisticsScreen.cashflowPoints. */}
      {cashflow.length >= 2 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">
            Vývoj zůstatku v čase
          </h2>
          <CashflowLineChart points={cashflow} locale={locale} />
          <div className="flex justify-between mt-3 text-xs text-ink-500">
            <span>
              Začátek: {fmt(cashflow[0].balance, "CZK", locale)}
            </span>
            <span
              className={`font-semibold ${
                cashflow[cashflow.length - 1].balance >= cashflow[0].balance
                  ? "text-emerald-700"
                  : "text-red-700"
              }`}
            >
              Konec: {fmt(cashflow[cashflow.length - 1].balance, "CZK", locale)}
            </span>
          </div>
        </section>
      )}

      {/* Budget vs actual — sjednoceno s mobile StatisticsScreen.budgetProgress. */}
      {budgetProgress.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">
            Rozpočty (skutečnost vs limit)
          </h2>
          <div className="space-y-3">
            {budgetProgress.map((bp) => {
              const pct = bp.percent;
              const colorClass =
                pct < 70 ? "bg-emerald-500" : pct < 90 ? "bg-amber-500" : "bg-red-500";
              const textColor =
                pct < 70 ? "text-emerald-700" : pct < 90 ? "text-amber-700" : "text-red-700";
              return (
                <div key={bp.name} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-medium text-ink-900 flex-1 truncate">
                      {bp.name}
                    </div>
                    <div className={`text-sm font-semibold ${textColor} tabular-nums`}>
                      {fmt(bp.spent, "CZK", locale)} / {fmt(bp.limit, "CZK", locale)}
                    </div>
                  </div>
                  <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${colorClass} rounded-full transition-all`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className={`text-xs ${textColor}`}>
                    {Math.round(pct)} %
                    {pct > 100 && " (přes limit!)"}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recurring payments — pravidelné platby (předplatné, nájem, splátky).
          V36: sjednoceno s mobile StatisticsScreen.recurringPayments. */}
      {recurringPayments.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          {(() => {
            const monthlyEq = recurringPayments.reduce((s, r) => {
              const m =
                r.frequency === "weekly"
                  ? r.avgAmount * 4.33
                  : r.frequency === "biweekly"
                  ? r.avgAmount * 2.17
                  : r.frequency === "monthly"
                  ? r.avgAmount
                  : r.frequency === "quarterly"
                  ? r.avgAmount / 3
                  : 0;
              return s + m;
            }, 0);
            return (
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-semibold text-ink-900">Pravidelné platby</h2>
                <div className="text-xs font-semibold text-brand-600">
                  ≈ {fmt(monthlyEq, "CZK", locale)}/měs
                </div>
              </div>
            );
          })()}
          <div className="divide-y divide-ink-100">
            {recurringPayments.slice(0, 10).map((r) => {
              const freqLabel =
                r.frequency === "weekly"
                  ? "týdně"
                  : r.frequency === "biweekly"
                  ? "2× měsíc"
                  : r.frequency === "monthly"
                  ? "měsíčně"
                  : "kvartálně";
              return (
                <div
                  key={r.merchant}
                  className="flex items-center justify-between py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink-900 truncate">
                      {r.merchant}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      {freqLabel} · {r.occurrences}× · od {r.lastDate}
                    </div>
                  </div>
                  <div className="text-sm font-bold text-ink-900 tabular-nums">
                    {fmt(r.avgAmount, "CZK", locale)}
                  </div>
                </div>
              );
            })}
            {recurringPayments.length > 10 && (
              <div className="text-xs text-ink-500 pt-2">
                + {recurringPayments.length - 10} dalších
              </div>
            )}
          </div>
        </section>
      )}

      {/* Top merchanti — kde nejvíc utrácíš.
          V35: sjednoceno s mobile StatisticsScreen.topMerchants. */}
      {topMerchants.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">
            Top obchodníci (kde nejvíc utratíš)
          </h2>
          <div className="space-y-3">
            {topMerchants.map((m) => {
              const maxAmount = topMerchants[0].amount;
              const fraction = maxAmount > 0 ? m.amount / maxAmount : 0;
              return (
                <div key={m.name} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-medium text-ink-900 truncate flex-1">
                      {m.name}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-red-700 tabular-nums">
                        {fmt(m.amount, "CZK", locale)}
                      </div>
                      <div className="text-[10px] text-ink-500">{m.count}×</div>
                    </div>
                  </div>
                  <div className="h-1 bg-ink-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500/70 rounded-full"
                      style={{ width: `${fraction * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function CashflowLineChart({
  points,
  locale,
}: {
  points: { label: string; balance: number }[];
  locale: string;
}) {
  if (points.length < 2) return null;
  const W = 600;
  const H = 160;
  const PAD = 8;
  const minBal = Math.min(...points.map((p) => p.balance));
  const maxBal = Math.max(...points.map((p) => p.balance));
  const range = maxBal - minBal || 1;
  const stepX = (W - 2 * PAD) / (points.length - 1);
  const yFor = (b: number) => PAD + ((maxBal - b) / range) * (H - 2 * PAD);
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${PAD + i * stepX} ${yFor(p.balance)}`)
    .join(" ");
  const fillD =
    `M ${PAD} ${H - PAD} ` +
    points
      .map((p, i) => `L ${PAD + i * stepX} ${yFor(p.balance)}`)
      .join(" ") +
    ` L ${PAD + (points.length - 1) * stepX} ${H - PAD} Z`;
  const zeroY = minBal < 0 && maxBal > 0 ? yFor(0) : null;
  const last = points[points.length - 1];
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-40"
      >
        {zeroY !== null && (
          <line
            x1={PAD}
            y1={zeroY}
            x2={W - PAD}
            y2={zeroY}
            stroke="#cbd5e1"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}
        <path d={fillD} fill="rgba(99, 102, 241, 0.12)" />
        <path
          d={pathD}
          stroke="rgb(99, 102, 241)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={PAD + (points.length - 1) * stepX}
          cy={yFor(last.balance)}
          r="4"
          fill="rgb(99, 102, 241)"
        />
      </svg>
      <div className="flex justify-between text-[10px] text-ink-500 mt-1">
        <span>{points[0].label}</span>
        {points.length >= 5 && (
          <span>{points[Math.floor(points.length / 2)].label}</span>
        )}
        <span>{last.label}</span>
      </div>
    </div>
  );
}

function InsightChip({
  label,
  value,
  isPositive,
}: {
  label: string;
  value: string;
  isPositive: boolean;
}) {
  const bg = isPositive ? "bg-emerald-50" : "bg-red-50";
  const fg = isPositive ? "text-emerald-700" : "text-red-700";
  const fgMuted = isPositive ? "text-emerald-600" : "text-red-600";
  return (
    <div className={`${bg} rounded-xl px-4 py-2.5 inline-flex flex-col`}>
      <div className={`text-[10px] uppercase tracking-wide font-medium ${fgMuted}`}>
        {label}
      </div>
      <div className={`text-lg font-bold ${fg} tabular-nums`}>{value}</div>
    </div>
  );
}

// ─── Sub components ───────────────────────────────────────────────────

function Tile({
  label,
  amount,
  color,
  sign,
  absoluteAmount = false,
  locale,
}: {
  label: string;
  amount: number;
  color: string;
  sign: string;
  absoluteAmount?: boolean;
  locale: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${color}`}>
        {sign}
        {fmt(absoluteAmount ? Math.abs(amount) : amount, "CZK", locale)}
      </div>
    </div>
  );
}


// ─── Trend computation ────────────────────────────────────────────────

interface TrendBucket {
  label: string;
  income: number;
  expense: number;
}

function buildTrend(txs: UiTransaction[], period: Period): TrendBucket[] {
  const now = new Date();
  let granularity: "day" | "week" | "month";
  let buckets = 0;

  switch (period) {
    case "7d":
      granularity = "day";
      buckets = 7;
      break;
    case "30d":
      granularity = "day";
      buckets = 30;
      break;
    case "3m":
      granularity = "week";
      buckets = 13;
      break;
    case "6m":
      granularity = "week";
      buckets = 26;
      break;
    case "1y":
      granularity = "month";
      buckets = 12;
      break;
    default:
      granularity = "month";
      buckets = 12;
  }

  const result: TrendBucket[] = [];
  const map = new Map<string, TrendBucket>();

  for (let i = buckets - 1; i >= 0; i--) {
    const d = new Date(now);
    let key = "";
    let label = "";
    if (granularity === "day") {
      d.setDate(d.getDate() - i);
      key = d.toISOString().slice(0, 10);
      label = `${d.getDate()}.${d.getMonth() + 1}`;
    } else if (granularity === "week") {
      d.setDate(d.getDate() - i * 7);
      const monday = new Date(d);
      const day = monday.getDay() || 7;
      monday.setDate(monday.getDate() - day + 1);
      key = monday.toISOString().slice(0, 10);
      label = `${monday.getDate()}.${monday.getMonth() + 1}`;
    } else {
      d.setMonth(d.getMonth() - i);
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = key.slice(5);
    }
    const bucket = { label, income: 0, expense: 0 };
    map.set(key, bucket);
    result.push(bucket);
  }

  for (const tx of txs) {
    if (!tx.date) continue;
    let key: string;
    if (granularity === "day") {
      key = tx.date;
    } else if (granularity === "week") {
      const d = new Date(tx.date);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      key = d.toISOString().slice(0, 10);
    } else {
      key = tx.date.slice(0, 7);
    }
    const b = map.get(key);
    if (!b) continue;
    if (tx.type === "INCOME") b.income += tx.amount;
    else if (tx.type === "EXPENSE") b.expense += tx.amount;
  }

  return result;
}

function fmt(amount: number, currency: string, locale: string = "cs-CZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string, locale: string = "cs-CZ"): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
