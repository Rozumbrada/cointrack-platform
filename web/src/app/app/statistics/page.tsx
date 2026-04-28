"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerCategory,
  ServerTransaction,
  toUiTransaction,
  UiTransaction,
} from "@/lib/sync-types";
import {
  Period,
  PeriodSelector,
  periodRange,
} from "@/components/app/PeriodSelector";
import { CategoryIcon } from "@/components/app/CategoryIcon";
import { ExpenseDonut, categoryColor } from "@/components/app/ExpenseDonut";

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

  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const categoryEntities = entitiesByProfile<ServerCategory>("categories");

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
      return true;
    });
  }, [uiTxs, range]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of inPeriod) {
      if (tx.type === "INCOME") income += tx.amount;
      else if (tx.type === "EXPENSE") expense += tx.amount;
    }
    return { income, expense, net: income - expense };
  }, [inPeriod]);

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
                        <span className={`text-ink-400 text-xs w-3 ${isExpanded ? "" : "-rotate-90"}`}>
                          ▾
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
                        <button
                          className="text-ink-400 hover:text-ink-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategory(c.cid);
                          }}
                          title={isHidden ? t("show_in_chart") : t("hide_from_chart")}
                        >
                          {isHidden ? "👁" : "🚫"}
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
