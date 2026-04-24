"use client";

import { useEffect, useMemo, useState } from "react";
import { sync, SyncEntity } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface TxData {
  type: "INCOME" | "EXPENSE" | "TRANSFER";
  amount: number;
  currency: string;
  accountId: number;
  note: string;
  dateTime: string;
  externalProvider?: string;
}

interface AccountData {
  name: string;
  currency: string;
}

export default function TransactionsPage() {
  const [txs, setTxs] = useState<SyncEntity[]>([]);
  const [accounts, setAccounts] = useState<Map<string, AccountData>>(new Map());
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await withAuth((t) => sync.pull(t));
        setTxs(res.entities["transactions"] ?? []);
        const map = new Map<string, AccountData>();
        for (const e of res.entities["accounts"] ?? []) {
          map.set(e.syncId, e.data as unknown as AccountData);
        }
        setAccounts(map);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return [...txs]
      .filter((e) => !e.deletedAt)
      .map((e) => ({ syncId: e.syncId, data: e.data as unknown as TxData }))
      .filter((r) => (filter === "ALL" ? true : r.data.type === filter))
      .filter((r) =>
        query ? r.data.note?.toLowerCase().includes(query.toLowerCase()) : true,
      )
      .sort((a, b) => b.data.dateTime.localeCompare(a.data.dateTime));
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
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">Transakce</h1>
        <p className="text-sm text-ink-600 mt-1">Všechny transakce napříč účty.</p>
      </div>

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
            {filtered.map((r) => (
              <li key={r.syncId} className="px-6 py-3 flex items-center gap-3">
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
                  <div className="text-sm text-ink-900 truncate">
                    {r.data.note || "(bez popisu)"}
                    {r.data.externalProvider === "saltedge" && (
                      <span className="ml-2 inline-block text-[10px] uppercase tracking-wide bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
                        banka
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-500">{formatDate(r.data.dateTime)}</div>
                </div>
                <div
                  className={`text-sm font-semibold tabular-nums ${
                    r.data.type === "INCOME" ? "text-emerald-700" : "text-ink-900"
                  }`}
                >
                  {r.data.type === "INCOME" ? "+" : r.data.type === "EXPENSE" ? "−" : ""}
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
