"use client";

import { useMemo, useState } from "react";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerCategory,
  ServerTransaction,
  toUiTransaction,
  UiTransaction,
} from "@/lib/sync-types";

type Period = "7d" | "30d" | "3m" | "6m" | "1y" | "all";

export default function StatisticsPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const [period, setPeriod] = useState<Period>("30d");
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

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

  const dateFrom = useMemo(() => {
    if (period === "all") return null;
    const d = new Date();
    switch (period) {
      case "7d": d.setDate(d.getDate() - 7); break;
      case "30d": d.setDate(d.getDate() - 30); break;
      case "3m": d.setMonth(d.getMonth() - 3); break;
      case "6m": d.setMonth(d.getMonth() - 6); break;
      case "1y": d.setFullYear(d.getFullYear() - 1); break;
    }
    return d.toISOString().slice(0, 10);
  }, [period]);

  const inPeriod = useMemo(() => {
    return uiTxs.filter((tx) => !dateFrom || tx.date >= dateFrom);
  }, [uiTxs, dateFrom]);

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

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        Chyba: {error}
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Statistiky</h1>
          <p className="text-sm text-ink-600 mt-1">
            Přehled výdajů podle kategorií + trend v čase.
          </p>
        </div>
        <PeriodSelector period={period} onChange={setPeriod} />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile label="Příjmy" amount={totals.income} color="text-emerald-700" sign="+" />
        <Tile label="Výdaje" amount={totals.expense} color="text-red-700" sign="−" />
        <Tile
          label="Bilance"
          amount={totals.net}
          color={totals.net >= 0 ? "text-emerald-700" : "text-red-700"}
          sign={totals.net >= 0 ? "+" : "−"}
          absoluteAmount
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut + legend */}
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">Výdaje podle kategorií</h2>
          {visibleCategoryStats.length === 0 ? (
            <div className="py-12 text-center text-ink-500 text-sm">
              Žádné výdaje v tomto období.
            </div>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <DonutChart segments={visibleCategoryStats.slice(0, 8)} total={totalVisibleExpense} />
              </div>
              <ul className="space-y-2 max-h-80 overflow-y-auto">
                {categoryStats.map((c) => {
                  const isHidden = hiddenCategories.has(c.cid);
                  const pct = totalVisibleExpense > 0 && !isHidden
                    ? (c.amount / totalVisibleExpense) * 100
                    : 0;
                  return (
                    <li
                      key={c.cid}
                      className={`flex items-center gap-3 text-sm cursor-pointer ${
                        isHidden ? "opacity-40" : ""
                      }`}
                      onClick={() => toggleCategory(c.cid)}
                    >
                      <div
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{
                          backgroundColor: categoryColor(c.category, c.cid),
                        }}
                      />
                      <div className="flex-1 min-w-0 truncate">
                        {c.category?.icon ? `${c.category.icon} ` : ""}
                        {c.category?.name ?? "Bez kategorie"}
                      </div>
                      <div className="text-xs text-ink-500 tabular-nums">
                        {pct.toFixed(0)} %
                      </div>
                      <div className="font-medium tabular-nums w-24 text-right">
                        {fmt(c.amount, "CZK")}
                      </div>
                      <button className="text-ink-400 hover:text-ink-700">
                        {isHidden ? "👁" : "🚫"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* Bar chart trend */}
        <section className="bg-white rounded-2xl border border-ink-200 p-5">
          <h2 className="font-semibold text-ink-900 mb-4">Trend</h2>
          {trend.length === 0 ? (
            <div className="py-12 text-center text-ink-500 text-sm">
              Žádná data.
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
                          title={`Příjmy: ${fmt(b.income, "CZK")}`}
                        />
                        <div
                          className="flex-1 bg-red-500 rounded-t"
                          style={{ height: `${Math.max(hEx, b.expense > 0 ? 3 : 0)}%` }}
                          title={`Výdaje: ${fmt(b.expense, "CZK")}`}
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
                  <div className="w-3 h-3 bg-emerald-500 rounded" /> Příjmy
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 bg-red-500 rounded" /> Výdaje
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

function PeriodSelector({
  period,
  onChange,
}: {
  period: Period;
  onChange: (p: Period) => void;
}) {
  const options: Array<{ value: Period; label: string }> = [
    { value: "7d", label: "7 dní" },
    { value: "30d", label: "30 dní" },
    { value: "3m", label: "3 měs." },
    { value: "6m", label: "6 měs." },
    { value: "1y", label: "1 rok" },
    { value: "all", label: "Vše" },
  ];
  return (
    <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-xs self-start">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-2 ${
            period === o.value
              ? "bg-brand-50 text-brand-700"
              : "text-ink-700 hover:bg-ink-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({
  label,
  amount,
  color,
  sign,
  absoluteAmount = false,
}: {
  label: string;
  amount: number;
  color: string;
  sign: string;
  absoluteAmount?: boolean;
}) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${color}`}>
        {sign}
        {fmt(absoluteAmount ? Math.abs(amount) : amount, "CZK")}
      </div>
    </div>
  );
}

function DonutChart({
  segments,
  total,
}: {
  segments: Array<{ cid: string; amount: number; category?: ServerCategory }>;
  total: number;
}) {
  if (total === 0 || segments.length === 0) return null;
  const size = 180;
  const stroke = 32;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#f1f5f9"
        strokeWidth={stroke}
      />
      {segments.map((s) => {
        const len = (s.amount / total) * circ;
        const dasharray = `${len} ${circ - len}`;
        const dashoffset = -offset;
        offset += len;
        return (
          <circle
            key={s.cid}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={categoryColor(s.category, s.cid)}
            strokeWidth={stroke}
            strokeDasharray={dasharray}
            strokeDashoffset={dashoffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
      <text
        x={size / 2}
        y={size / 2 - 4}
        textAnchor="middle"
        className="text-xs fill-ink-500"
      >
        Celkem
      </text>
      <text
        x={size / 2}
        y={size / 2 + 14}
        textAnchor="middle"
        className="text-sm font-semibold fill-ink-900"
      >
        {fmt(total, "CZK")}
      </text>
    </svg>
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

function categoryColor(cat: ServerCategory | undefined, fallbackKey: string): string {
  if (cat?.color) {
    const n = (cat.color >>> 0);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
  }
  // Stabilní fallback color z hash klíče
  const hash = Array.from(fallbackKey).reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 55%)`;
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
