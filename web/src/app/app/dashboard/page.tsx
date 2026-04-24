"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSyncData } from "@/lib/sync-hook";

interface AccountData {
  name: string;
  type: string;
  balance: number;
  currency: string;
  includeInTotal: boolean;
  profileId?: number;
}

interface TransactionData {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  accountId: number;
  note: string;
  dateTime: string;
  profileId?: number;
}

export default function DashboardPage() {
  const { loading, error, entitiesByProfile } = useSyncData();

  const accounts = entitiesByProfile<AccountData>("accounts");
  const transactions = entitiesByProfile<TransactionData>("transactions");

  const totalBalance = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const a of accounts) {
      if (!a.data.includeInTotal) continue;
      totals[a.data.currency] = (totals[a.data.currency] ?? 0) + a.data.balance;
    }
    return totals;
  }, [accounts]);

  const monthlyStats = useMemo(() => {
    const now = new Date();
    const monthKey = now.toISOString().slice(0, 7);
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (!t.data.dateTime?.startsWith(monthKey)) continue;
      if (t.data.type === "INCOME") income += t.data.amount;
      else if (t.data.type === "EXPENSE") expense += t.data.amount;
    }
    return { income, expense };
  }, [transactions]);

  const recent = useMemo(() => {
    return [...transactions]
      .sort((a, b) => (b.data.dateTime ?? "").localeCompare(a.data.dateTime ?? ""))
      .slice(0, 10);
  }, [transactions]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Přehled</h1>
        <p className="text-sm text-ink-600 mt-1">
          Přehled financí pro aktivní profil.
        </p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Tile label="Celkový zůstatek">
          <div className="space-y-0.5">
            {Object.entries(totalBalance).length === 0 ? (
              <div className="text-ink-500 text-sm">—</div>
            ) : (
              Object.entries(totalBalance).map(([cur, amount]) => (
                <div key={cur} className="text-2xl font-semibold text-ink-900">
                  {fmt(amount, cur)}
                </div>
              ))
            )}
          </div>
        </Tile>
        <Tile label="Příjmy tento měsíc">
          <div className="text-2xl font-semibold text-emerald-700">
            +{fmt(monthlyStats.income, "CZK")}
          </div>
        </Tile>
        <Tile label="Výdaje tento měsíc">
          <div className="text-2xl font-semibold text-red-700">
            −{fmt(monthlyStats.expense, "CZK")}
          </div>
        </Tile>
      </div>

      {/* Recent transactions */}
      <section className="bg-white rounded-2xl border border-ink-200">
        <div className="px-6 py-4 border-b border-ink-200 flex items-center justify-between">
          <h2 className="font-semibold text-ink-900">Poslední transakce</h2>
          <Link href="/app/transactions" className="text-sm text-brand-600 hover:text-brand-700">
            Všechny →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-ink-500 text-sm">
            Žádné transakce. Napoj banku nebo naskenuj účtenku v mobilu.
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {recent.map((r) => (
              <li key={r.syncId} className="px-6 py-3 flex items-center gap-3">
                <div
                  className={`w-8 h-8 rounded-full grid place-items-center text-sm ${
                    r.data.type === "INCOME"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {r.data.type === "INCOME" ? "↓" : "↑"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink-900 truncate">
                    {r.data.note || "(bez popisu)"}
                  </div>
                  <div className="text-xs text-ink-500">
                    {formatDate(r.data.dateTime)}
                  </div>
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    r.data.type === "INCOME" ? "text-emerald-700" : "text-ink-900"
                  }`}
                >
                  {r.data.type === "INCOME" ? "+" : "−"}
                  {fmt(r.data.amount, r.data.currency)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      {children}
    </div>
  );
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
