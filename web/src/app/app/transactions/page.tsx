"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { getPersistedSearch, setPersistedSearch } from "@/lib/persisted-search";
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
import { Pencil, Trash2 } from "lucide-react";

export default function TransactionsPage() {
  const t = useTranslations("transactions_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, diagnose, profileSyncId, reload } = useSyncData();

  const [filter, setFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  /** "ALL" = vše, "CASH" = bez vazby na účet, jinak account syncId */
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  /**
   * Category filter — multi-select. Empty set = vše. Sentinel "__none__" =
   * tx bez kategorie (categoryId == null).
   */
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const UNCATEGORIZED_SENTINEL = "__none__";
  // Search persistovaný v sessionStorage — přežívá navigaci v rámci tabu
  // (klik na řádek → detail tx → zpět zachová text v search inputu).
  const [query, setQuery] = useState(() => getPersistedSearch("transactions"));
  useEffect(() => { setPersistedSearch("transactions", query); }, [query]);
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

  // Map: account syncId → account name (pro fulltext search "Hlavní účet")
  const accountNameMap = useMemo(() => {
    const m = new Map<string, string>();
    accounts.forEach((a) => m.set(a.syncId, a.data.name));
    return m;
  }, [accounts]);

  // Map: account syncId → account.type (pro detekci CASH účtu při filtru)
  const accountTypeMap = useMemo(() => {
    const m = new Map<string, string>();
    accounts.forEach((a) => m.set(a.syncId, (a.data.type ?? "").toUpperCase()));
    return m;
  }, [accounts]);

  // Map: tx syncId → raw ServerTransaction (pro search v bankVs/protistrana/atd.,
  // které UiTransaction nemá).
  const rawTxMap = useMemo(() => {
    const m = new Map<string, ServerTransaction>();
    txEntities.forEach((e) => m.set(e.syncId, e.data));
    return m;
  }, [txEntities]);

  const diag = diagnose("transactions");

  // Map server data → UI shape
  const uiTxs = useMemo(
    () => txEntities.map((e) => toUiTransaction(e.syncId, e.data)),
    [txEntities],
  );

  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);

  const filtered = useMemo(() => {
    // Pre-parse query — lowercase + amount → number (pokud uživatel zadal "1500" nebo "1 500,00")
    const ql = query.trim().toLowerCase();
    const qAmount = ql ? parseFloat(ql.replace(/[\s ]/g, "").replace(",", ".")) : NaN;
    const hasAmountQuery = Number.isFinite(qAmount);
    // Pokud je query čistě číselný (např. variabilní symbol "6042026"), pak na
    // numerických ID polích (VS, bankTxId) chce uživatel **přesnou shodu**, ne
    // substring. Jinak by '6042026' v hledání zachytilo i tx s VS '6032026',
    // které mají popisku obsahující '6042026' (datum 6.4.2026 apod.).
    const isNumericQuery = /^\d+$/.test(ql);

    return [...uiTxs]
      .filter((r) => (filter === "ALL" ? true : r.type === filter))
      .filter((r) => {
        if (accountFilter === "ALL") return true;
        // "CASH" match je široký: tx bez accountId (legacy hotovost)
        // PLUS tx napojené na účet typu CASH (mobile auto-linkuje na "Hotovost").
        if (accountFilter === "CASH") {
          if (!r.accountSyncId) return true;
          return accountTypeMap.get(r.accountSyncId) === "CASH";
        }
        // Specifický účet — exact match. Navíc: pokud je vybraný účet
        // typu CASH, dovol i tx bez accountId (legacy / nelinkované cash).
        if (r.accountSyncId === accountFilter) return true;
        if (!r.accountSyncId && accountTypeMap.get(accountFilter) === "CASH") return true;
        return false;
      })
      .filter((r) => {
        if (range.from && r.date < range.from) return false;
        if (range.to && r.date > range.to) return false;
        return true;
      })
      .filter((r) => {
        // Kategorie filter — pokud není nic vybráno, pusť vše. Jinak match
        // proti syncId nebo sentinelu pro tx bez kategorie.
        if (selectedCategoryIds.size === 0) return true;
        if (!r.categorySyncId) return selectedCategoryIds.has(UNCATEGORIZED_SENTINEL);
        return selectedCategoryIds.has(r.categorySyncId);
      })
      .filter((r) => {
        if (!ql) return true;
        // Match napříč poli z detailu transakce.
        //   - Numerický dotaz (samé číslice): exact match na VS / bankTxId,
        //     amount, date substring; description/merchant/atd. **NE** substring,
        //     aby '6042026' nematchnul tx s popiskou "Faktura 6.4.2026 — 6032026".
        //   - Textový (alespoň 1 nečíselný znak): substring napříč všemi.
        const raw = rawTxMap.get(r.syncId);

        if (isNumericQuery) {
          // Strict numeric — jen pole, kde se očekává konkrétní číselné ID.
          if (raw?.bankVs === ql) return true;
          if (raw?.bankTxId === ql) return true;
          // Amount tolerance ±0.01 Kč
          if (hasAmountQuery && Math.abs(r.amount - qAmount) < 0.01) return true;
          // Datum substring (např. '2026' najde všechny z 2026)
          if (r.date.includes(ql)) return true;
          return false;
        }

        // Textový dotaz — substring přes všechna textová pole
        if (r.description?.toLowerCase().includes(ql)) return true;
        if (r.merchant?.toLowerCase().includes(ql)) return true;
        if (raw?.bankVs?.toLowerCase().includes(ql)) return true;
        if (raw?.bankCounterparty?.toLowerCase().includes(ql)) return true;
        if (raw?.bankCounterpartyName?.toLowerCase().includes(ql)) return true;
        if (raw?.bankTxId?.toLowerCase().includes(ql)) return true;

        const accName = r.accountSyncId ? accountNameMap.get(r.accountSyncId) : undefined;
        if (accName?.toLowerCase().includes(ql)) return true;

        const catName = r.categorySyncId ? catMap.get(r.categorySyncId)?.name : undefined;
        if (catName?.toLowerCase().includes(ql)) return true;

        if (r.date.toLowerCase().includes(ql)) return true;
        if (hasAmountQuery && Math.abs(r.amount - qAmount) < 0.01) return true;

        return false;
      })
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [uiTxs, filter, accountFilter, query, range, rawTxMap, accountNameMap, accountTypeMap, catMap, selectedCategoryIds]);

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

  /** Soft-delete jedné transakce přes sync push. */
  async function deleteOne(syncId: string) {
    const entity = txEntities.find((r) => r.syncId === syncId);
    if (!entity) return;
    if (!confirm(t("delete_one_confirm"))) return;
    setBulkError(null);
    try {
      const now = new Date().toISOString();
      await withAuth((tk) =>
        sync.push(tk, {
          entities: {
            transactions: [
              {
                syncId: entity.syncId,
                updatedAt: now,
                deletedAt: now,
                clientVersion: 1,
                data: entity.data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(syncId);
        return next;
      });
      await reload();
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e));
    }
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

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        {t("error_prefix")} {error}
      </div>
    );

  const inSelectionMode = selected.size > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
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
            {t("new_transaction")}
          </Link>
        </div>
      </div>

      {!loading && diag.total > 0 && diag.matched === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <div className="font-medium mb-1">{t("no_results_for_profile_title")}</div>
          <p className="text-amber-700">{t("no_results_for_profile_desc", { total: diag.total })}</p>
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
          placeholder={t("search_placeholder")}
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
              {f === "ALL" ? t("filter_all") : f === "INCOME" ? t("filter_income") : t("filter_expense")}
            </button>
          ))}
        </div>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-700"
        >
          <option value="ALL">{t("all_accounts_cash")}</option>
          <option value="CASH">{t("cash_only")}</option>
          <option disabled>──────────</option>
          {accounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>
              {a.data.name} ({a.data.currency})
            </option>
          ))}
        </select>

        {/* Multi-select category dropdown.
            Klik otevře menu, checkbox toggle. Mimoklik close handlovaný
            backdrop overlay div absolutně-poziciovaným pod menu. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setCategoryMenuOpen((v) => !v)}
            className={`h-10 px-3 rounded-lg border text-sm flex items-center gap-1.5 ${
              selectedCategoryIds.size > 0
                ? "bg-brand-50 border-brand-300 text-brand-700"
                : "bg-white border-ink-300 text-ink-700 hover:bg-ink-50"
            }`}
            title="Filtrovat podle kategorie"
          >
            <span>
              {selectedCategoryIds.size === 0
                ? "Kategorie"
                : selectedCategoryIds.size === 1
                ? (() => {
                    const id = [...selectedCategoryIds][0];
                    if (id === UNCATEGORIZED_SENTINEL) return "Bez kategorie";
                    return catMap.get(id)?.name ?? "1 kategorie";
                  })()
                : `${selectedCategoryIds.size} kategorií`}
            </span>
            <span className="text-xs">▾</span>
          </button>

          {categoryMenuOpen && (
            <>
              {/* Backdrop pro mimoklik close */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setCategoryMenuOpen(false)}
              />
              <div className="absolute right-0 mt-1 z-20 w-64 max-h-80 overflow-auto rounded-lg border border-ink-200 bg-white shadow-lg p-1.5 text-sm">
                {selectedCategoryIds.size > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCategoryIds(new Set());
                        setCategoryMenuOpen(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-ink-50 text-red-600"
                    >
                      ✕ Zrušit filtr
                    </button>
                    <div className="border-t border-ink-100 my-1" />
                  </>
                )}
                {/* "Bez kategorie" sentinel */}
                <CatFilterRow
                  label="Bez kategorie"
                  color="#94a3b8"
                  checked={selectedCategoryIds.has(UNCATEGORIZED_SENTINEL)}
                  onToggle={() => {
                    setSelectedCategoryIds((prev) => {
                      const n = new Set(prev);
                      if (n.has(UNCATEGORIZED_SENTINEL)) n.delete(UNCATEGORIZED_SENTINEL);
                      else n.add(UNCATEGORIZED_SENTINEL);
                      return n;
                    });
                  }}
                />
                <div className="border-t border-ink-100 my-1" />
                {cats.map((c) => (
                  <CatFilterRow
                    key={c.syncId}
                    label={c.data.name}
                    color={colorFromInt(c.data.color ?? undefined)}
                    checked={selectedCategoryIds.has(c.syncId)}
                    onToggle={() => {
                      setSelectedCategoryIds((prev) => {
                        const n = new Set(prev);
                        if (n.has(c.syncId)) n.delete(c.syncId);
                        else n.add(c.syncId);
                        return n;
                      });
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {inSelectionMode && (
        <div className="sticky top-2 z-10 bg-brand-600 text-white rounded-xl p-3 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-3">
            <span className="font-medium">{t("selected", { n: selected.size })}</span>
            <button onClick={clearSelection} className="text-sm text-white/80 hover:text-white">
              {t("clear_selection")}
            </button>
          </div>
          <button
            onClick={bulkDelete}
            disabled={bulkDeleting}
            className="h-9 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium"
          >
            {bulkDeleting ? t("deleting") : t("delete_count", { n: selected.size })}
          </button>
        </div>
      )}

      <section className="bg-white rounded-2xl border border-ink-200">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-ink-500 text-sm">{t("no_results")}</div>
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
                {allSelected ? t("deselect_all") : t("select_all", { n: filtered.length })}
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
                      title={t("change_category")}
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
                          {tx.description || tx.merchant || t("no_description")}
                        </div>
                        <div className="text-xs text-ink-500 flex items-center gap-2 flex-wrap">
                          <span>{formatDate(tx.date, locale)}</span>
                          {cat && <span className="text-ink-400 truncate">· {cat.name}</span>}
                          {!tx.accountSyncId && (
                            <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide">
                              {t("cash_badge")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={`text-sm font-semibold tabular-nums ${amountColor}`}>
                        {sign}
                        {fmt(tx.amount, tx.currency, locale)}
                      </div>
                    </Link>
                    {/* Inline edit + delete — vždy viditelné, ne hover-only */}
                    <Link
                      href={`/app/transactions/${tx.syncId}/edit`}
                      onClick={(e) => e.stopPropagation()}
                      title={t("edit_action")}
                      aria-label={t("edit_action")}
                      className="shrink-0 p-2 rounded-lg text-ink-500 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteOne(tx.syncId);
                      }}
                      title={t("delete_action")}
                      aria-label={t("delete_action")}
                      className="shrink-0 p-2 rounded-lg text-ink-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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

function fmt(amount: number, currency: string, locale: string = "cs-CZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string, locale: string = "cs-CZ"): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function CatFilterRow({
  label,
  color,
  checked,
  onToggle,
}: {
  label: string;
  color: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink-50 text-left"
    >
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="w-4 h-4 accent-brand-600 pointer-events-none"
      />
      <span
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="flex-1 truncate text-ink-800">{label}</span>
    </button>
  );
}
