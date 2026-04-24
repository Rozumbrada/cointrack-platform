"use client";

import { useMemo } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface DebtData {
  personName: string;
  amount: number;
  currency: string;
  isOwedToMe: boolean;
  dueDate?: string;
  note?: string;
  isPaid?: boolean;
  profileId?: number;
}

export default function DebtsPage() {
  const { loading, error, entitiesByProfile } = useSyncData();
  const debts = entitiesByProfile<DebtData>("debts");

  const active = useMemo(() => debts.filter((d) => !d.data.isPaid), [debts]);
  const paid = useMemo(() => debts.filter((d) => d.data.isPaid), [debts]);

  const totals = useMemo(() => {
    let owedToMe = 0;
    let iOwe = 0;
    for (const d of active) {
      if (d.data.currency !== "CZK") continue;
      if (d.data.isOwedToMe) owedToMe += d.data.amount;
      else iOwe += d.data.amount;
    }
    return { owedToMe, iOwe };
  }, [active]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Dluhy & půjčky</h1>
        <p className="text-sm text-ink-600 mt-1">
          Přehled peněz, které ti někdo dluží nebo dlužíš ty někomu.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-ink-200 p-5">
          <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
            Dlužno mně
          </div>
          <div className="text-2xl font-semibold text-emerald-700">
            {fmt(totals.owedToMe, "CZK")}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-ink-200 p-5">
          <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
            Já dlužím
          </div>
          <div className="text-2xl font-semibold text-red-700">
            {fmt(totals.iOwe, "CZK")}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          Chyba: {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>
      ) : debts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🤝</div>
          <div className="font-medium text-ink-900">Žádné dluhy</div>
        </div>
      ) : (
        <>
          <Section title="Aktivní" items={active} />
          {paid.length > 0 && <Section title="Vyřešené" items={paid} dim />}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  items,
  dim = false,
}: {
  title: string;
  items: Array<{ syncId: string; data: DebtData }>;
  dim?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="bg-white rounded-2xl border border-ink-200">
      <div className="px-6 py-3 border-b border-ink-200">
        <h2 className="font-semibold text-ink-900">{title}</h2>
      </div>
      <ul className="divide-y divide-ink-100">
        {items.map((d) => (
          <li
            key={d.syncId}
            className={`px-6 py-3 flex items-center gap-3 ${dim ? "opacity-60" : ""}`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink-900 truncate">
                {d.data.personName}
              </div>
              <div className="text-xs text-ink-500 flex items-center gap-2">
                <span>{d.data.isOwedToMe ? "dluží mně" : "dlužím"}</span>
                {d.data.dueDate && <span>· do {d.data.dueDate}</span>}
                {d.data.isPaid && <span className="text-emerald-700">· ✓ vyřešeno</span>}
              </div>
              {d.data.note && (
                <div className="text-xs text-ink-500 mt-0.5 truncate">{d.data.note}</div>
              )}
            </div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                d.data.isOwedToMe ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {fmt(d.data.amount, d.data.currency)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
