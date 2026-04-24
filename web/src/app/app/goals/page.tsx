"use client";

import { useSyncData } from "@/lib/sync-hook";

interface GoalData {
  name: string;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  targetDate?: string;
  icon?: string;
  color?: number;
  profileId?: number;
}

export default function GoalsPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const goals = entitiesByProfile<GoalData>("goals");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Cíle</h1>
        <p className="text-sm text-ink-600 mt-1">
          Spořicí cíle — na dovolenou, na auto, rezervu…
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : goals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🎯</div>
          <div className="font-medium text-ink-900">Žádné cíle</div>
          <p className="text-sm text-ink-600 mt-2">
            Nastav si spořicí cíl v mobilní aplikaci.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g) => {
            const pct = Math.min(
              100,
              (g.data.currentAmount / Math.max(g.data.targetAmount, 1)) * 100,
            );
            const done = g.data.currentAmount >= g.data.targetAmount;
            return (
              <div key={g.syncId} className="bg-white rounded-2xl border border-ink-200 p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-lg grid place-items-center text-xl"
                    style={{ backgroundColor: colorFromInt(g.data.color) }}
                  >
                    {g.data.icon || "🎯"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink-900 truncate">{g.data.name}</div>
                    {g.data.targetDate && (
                      <div className="text-xs text-ink-500">do {g.data.targetDate}</div>
                    )}
                  </div>
                  {done && (
                    <span className="text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                      hotovo
                    </span>
                  )}
                </div>
                <div className="text-sm text-ink-600 mb-2 tabular-nums">
                  {fmt(g.data.currentAmount, g.data.currency)} / {fmt(g.data.targetAmount, g.data.currency)}
                </div>
                <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                  <div
                    className={`h-full ${done ? "bg-emerald-500" : "bg-brand-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-xs text-ink-500 mt-1.5">{Math.round(pct)} %</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
    maximumFractionDigits: 0,
  }).format(amount);
}
