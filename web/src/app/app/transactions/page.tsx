"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import {
  ServerAccount,
  ServerCategory,
  ServerTransaction,
  toUiTransaction,
} from "@/lib/sync-types";
import { CategoryIcon, colorFromInt } from "@/components/app/CategoryIcon";
import { CategoryPicker } from "@/components/app/CategoryPicker";
import {
  Period,
  PeriodSelector,
  periodRange,
} from "@/components/app/PeriodSelector";

export default function TransactionsPage() {
  const { loading, error, entitiesByProfile, diagnose, profileSyncId, reload } = useSyncData();
  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  /** "ALL" = vše, "CASH" = bez vazby na účet, jinak account syncId */
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<Period>("30d");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<{
    txSyncId: string;
    txType: "INCOME" | "EXPENSE" | "TRANSFER";
    currentCatSyncId?: string;
  } | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const txEntities = entitiesByProfile<ServerTransaction>("transactions");
  const cats = entitiesByProfile<ServerCategory>("categories");
  const accounts = entitiesByProfile<ServerAccount>("accounts");

  // Map: kategorie syncId → kategorie data
  const catMap = useMemo(() => {
    const m = new Map<string, ServerCategory>();
    cats.forEach((c) => m.set(c.syncId, c.data));
    return m;
  }, [cats]);

  const diag = diagnose("transactions");

  // Map server data → UI shape
  const uiTxs = useMemo(
    () => txEntities.map((e) => toUiTransaction(e.syncId, e.data)),
    [txEntities],
  );

  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);

  const filtered = useMemo(() => {
    return [...uiTxs]
      .filter((r) => (filter === "ALL" ? true : r.type === filter))
      .filter((r) => {
        if (accountFilter === "ALL") return true;
        if (accountFilter === "CASH") return !r.accountSyncId;
        return r.accountSyncId === accountFilter;
      })
      .filter((r) => {
        if (range.from && r.date < range.from) return false;
        if (range.to && r.date > range.to) return false;
        return true;
      })
      .filter((r) =>
        query
          ? (r.description?.toLowerCase().includes(query.toLowerCase()) ||
             r.merchant?.toLowerCase().includes(query.toLowerCase()))
          : true,
      )
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [uiTxs, filter, accountFilter, query, range]);

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.syncId));

  function toggleOne(syncId: string) {
    const next = new Set(selected);
    if (next.has(syncId)) next.delete(syncId);
    else next.add(syncId);
    setSelected(next);
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.syncId)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    const ok = confirm(`Opravdu smazat ${selected.size} transakcí? Akce je nevratná.`);
    if (!ok) return;

    setBulkDeleting(true);
    setBulkError(null);
    try {
      const now = new Date().toISOString();
      const entities = txEntities
        .filter((r) => selected.has(r.syncId))
        .map((r) => ({
          syncId: r.syncId,
          updatedAt: now,
          deletedAt: now,
          clientVersion: 1,
          data: r.data as unknown as Record<string, unknown>,
        }));

      const CHUNK = 100;
      for (let i = 0; i < entities.length; i += CHUNK) {
        const chunk = entities.slice(i, i + CHUNK);
        await withAuth((t) => sync.push(t, { entities: { transactions: chunk } }));
      }

      setSelected(new Set());
      await reload();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkDeleting(false);
    }
  }

  async function setCategoryFor(txSyncId: string, newCatSyncId: string | null) {
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

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        Chyba: {error}
      </div>
    );

  const inSelectionMode = selected.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Transakce</h1>
          <p className="text-sm text-ink-600 mt-1">Všechny transakce pro aktivní profil.</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector
            period={period}
            onChange={setPeriod}
            custom={customRange}
            onCustomChange={setCustomRange}
          />
          <Link
            href="/app/transactions/new"
            className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium grid place-items-center"
          >
            + Nová
          </Link>
        </div>
      </div>

      {!loading && diag.total > 0 && diag.matched === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <div className="font-medium mb-1">Žádné transakce pro aktivní profil</div>
          <p className="text-amber-700">
            Máš {diag.total} transakcí celkem, ale žádná z nich nepatří do právě vybraného profilu.
          </p>
        </div>
      )}

      {bulkError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {bulkError}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Hledat v popisu nebo obchodníkovi…"
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
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-700"
        >
          <option value="ALL">Všechny účty + hotovost</option>
          <option value="CASH">💵 Pouze hotovost</option>
          <option disabled>──────────</option>
          {accounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>
              {a.data.name} ({a.data.currency})
            </option>
          ))}
        </select>
      </div>

      {inSelectionMode && (
        <div className="sticky top-2 z-10 bg-brand-600 text-white rounded-xl p-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <span className="font-medium">Vybráno: {selected.size}</span>
            <button onClick={clearSelection} className="text-sm text-white/80 hover:text-white">
              Zrušit výběr
            </button>
          </div>
          <button
            onClick={bulkDelete}
            disabled={bulkDeleting}
            className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium"
          >
            {bulkDeleting ? "Mažu…" : `🗑 Smazat ${selected.size}`}
          </button>
        </div>
      )}

      <section className="bg-white rounded-2xl border border-ink-200">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-ink-500 text-sm">Žádné výsledky.</div>
        ) : (
          <>
            <div className="px-6 py-2 border-b border-ink-100 flex items-center gap-3 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="w-4 h-4 cursor-pointer"
              />
              <span>
                {allSelected ? "Zrušit výběr všech" : `Vybrat všech ${filtered.length}`}
              </span>
            </div>
            <ul className="divide-y divide-ink-100">
              {filtered.map((tx) => {
                const cat = tx.categorySyncId ? catMap.get(tx.categorySyncId) : undefined;
                const isSelected = selected.has(tx.syncId);
                const sign = tx.type === "INCOME" ? "+" : tx.type === "EXPENSE" ? "−" : "";
                const amountColor =
                  tx.type === "INCOME" ? "text-emerald-700" :
                  tx.type === "EXPENSE" ? "text-ink-900" :
                  "text-ink-600";
                return (
                  <li
                    key={tx.syncId}
                    className={`px-6 py-3 flex items-center gap-3 transition-colors ${
                      isSelected ? "bg-brand-50" : "hover:bg-ink-50/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(tx.syncId)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 cursor-pointer shrink-0"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPickerFor({
                          txSyncId: tx.syncId,
                          txType: tx.type,
                          currentCatSyncId: tx.categorySyncId,
                        });
                      }}
                      title="Změnit kategorii"
                      disabled={tx.type === "TRANSFER"}
                      className="w-9 h-9 rounded-full grid place-items-center shrink-0 hover:ring-2 hover:ring-brand-500/40 transition-all disabled:opacity-60 disabled:cursor-default"
                      style={{
                        backgroundColor: cat
                          ? colorFromInt(cat.color)
                          : tx.type === "INCOME"
                            ? "rgba(16, 185, 129, 0.15)"
                            : tx.type === "EXPENSE"
                              ? "rgba(239, 68, 68, 0.15)"
                              : "rgba(99, 102, 241, 0.15)",
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
                      className="flex-1 flex items-center gap-3 min-w-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ink-900 truncate">
                          {tx.description || tx.merchant || "(bez popisu)"}
                        </div>
                        <div className="text-xs text-ink-500 flex items-center gap-2 flex-wrap">
                          <span>{formatDate(tx.date)}</span>
                          {cat && <span className="text-ink-400 truncate">· {cat.name}</span>}
                          {!tx.accountSyncId && (
                            <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide">
                              💵 hotovost
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={`text-sm font-semibold tabular-nums ${amountColor}`}>
                        {sign}
                        {fmt(tx.amount, tx.currency)}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {pickerError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
          {pickerError}
        </div>
      )}

      {pickerFor && (
        <CategoryPicker
          allCategories={cats}
          currentSyncId={pickerFor.currentCatSyncId}
          txType={pickerFor.txType}
          onClose={() => setPickerFor(null)}
          onSelect={async (catSyncId) => {
            const target = pickerFor;
            setPickerFor(null);
            await setCategoryFor(target.txSyncId, catSyncId);
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
