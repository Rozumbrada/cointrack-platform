"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSyncData } from "@/lib/sync-hook";

interface TxData {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  accountId: number;
  categoryId?: number;
  note: string;
  dateTime: string;
  externalProvider?: string;
  profileId?: number;
}

interface CategoryData {
  id?: number;
  name: string;
  icon?: string;
}

export default function TransactionsPage() {
  const { loading, error, entitiesByProfile, diagnose, profileSyncId } = useSyncData();
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  const [query, setQuery] = useState("");

  const txs = entitiesByProfile<TxData>("transactions");
  const diag = diagnose("transactions");
  const cats = entitiesByProfile<CategoryData>("categories");
  const catMap = useMemo(() => {
    const m = new Map<number, CategoryData>();
    cats.forEach((c) => c.data.id && m.set(c.data.id, c.data));
    return m;
  }, [cats]);

  const filtered = useMemo(() => {
    return [...txs]
      .filter((r) => (filter === "ALL" ? true : r.data.type === filter))
      .filter((r) =>
        query ? r.data.note?.toLowerCase().includes(query.toLowerCase()) : true,
      )
      .sort((a, b) => (b.data.dateTime ?? "").localeCompare(a.data.dateTime ?? ""));
  }, [txs, filter, query]);

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        Chyba: {error}
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Transakce</h1>
          <p className="text-sm text-ink-600 mt-1">Všechny transakce pro aktivní profil.</p>
        </div>
        <Link
          href="/app/transactions/new"
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium grid place-items-center"
        >
          + Nová
        </Link>
      </div>

      {!loading && diag.total > 0 && diag.matched === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <div className="font-medium mb-1">Žádné transakce pro aktivní profil</div>
          <p className="text-amber-700">
            Máš {diag.total} transakcí celkem, ale žádná z nich nepatří do právě vybraného profilu.
            Zkontroluj přepínač profilu nahoře — možná patří do jiného profilu.
          </p>
          {profileSyncId && (
            <p className="text-[10px] text-amber-600 mt-2 font-mono break-all">
              aktivní profil: {profileSyncId}
            </p>
          )}
          {diag.otherProfiles.size > 0 && (
            <p className="text-[10px] text-amber-600 mt-1 font-mono break-all">
              profily v datech: {Array.from(diag.otherProfiles).slice(0, 5).join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Hledat v poznámkách…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm">
          {(["ALL", "INCOME", "EXPENSE"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 transition-colors ${
                filter === f ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {f === "ALL" ? "Vše" : f === "INCOME" ? "Příjmy" : "Výdaje"}
            </button>
          ))}
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-ink-200">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-ink-500 text-sm">Žádné výsledky.</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {filtered.map((r) => {
              const cat = r.data.categoryId ? catMap.get(r.data.categoryId) : undefined;
              return (
                <li key={r.syncId}>
                <Link href={`/app/transactions/${r.syncId}/edit`} className="px-6 py-3 flex items-center gap-3 hover:bg-ink-50/50 transition-colors">
                  <div
                    className={`w-8 h-8 rounded-full grid place-items-center text-sm ${
                      r.data.type === "INCOME"
                        ? "bg-emerald-100 text-emerald-700"
                        : r.data.type === "EXPENSE"
                          ? "bg-red-100 text-red-700"
                          : "bg-ink-100 text-ink-600"
                    }`}
                  >
                    {r.data.type === "INCOME" ? "↓" : r.data.type === "EXPENSE" ? "↑" : "⇄"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink-900 truncate flex items-center gap-2">
                      {r.data.note || "(bez popisu)"}
                      {r.data.externalProvider === "saltedge" && (
                        <span className="inline-block text-[10px] uppercase tracking-wide bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                          banka
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500 flex items-center gap-2">
                      <span>{formatDate(r.data.dateTime)}</span>
                      {cat && (
                        <span className="text-ink-400">
                          · {cat.icon} {cat.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold tabular-nums ${
                      r.data.type === "INCOME" ? "text-emerald-700" : "text-ink-900"
                    }`}
                  >
                    {r.data.type === "INCOME" ? "+" : r.data.type === "EXPENSE" ? "−" : ""}
                    {fmt(r.data.amount, r.data.currency)}
                  </div>
                </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
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
