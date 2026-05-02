"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import { getPersistedSearch, setPersistedSearch } from "@/lib/persisted-search";
import { getCachedProfileType, getCurrentProfileSyncId } from "@/lib/profile-store";
import {
  Period,
  PeriodSelector,
  periodRange,
} from "@/components/app/PeriodSelector";
import { InvoiceEditor } from "@/components/app/InvoiceEditor";
import { ExportButton } from "@/components/app/ExportButton";

interface InvoiceData {
  profileId?: string;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  supplierName?: string;
  customerName?: string;
  totalWithVat: string | number;     // server posílá string
  currency?: string;
  isExpense: boolean;
  paid?: boolean;                    // ne 'isPaid'!
  linkedTransactionId?: string;
  variableSymbol?: string;           // ne 'variabilniSymbol'
  fileKeys?: unknown;
  linkedAccountId?: string;
  /** "CASH" / "BANK_TRANSFER" / "CARD" / "OTHER". Pro filtr "Pouze hotovost". */
  paymentMethod?: string;
  /** ISO timestamp posledního Pohoda XML exportu. Null = nikdy. */
  exportedAt?: string | null;
  /** V30 — origin tracking (manual/scan/idoklad/email) */
  source?: string;
  emailSubject?: string;
  emailSender?: string;
  /** iDoklad ID — pokud > 0, faktura pochází z iDokladu. Pro PERSONAL profil
   *  takové faktury skryjeme (osobní účet nemá iDoklad — bug v starších verzích). */
  idokladId?: string;
}

type AccountListEntry = { syncId: string; data: ServerAccount };

export default function InvoicesPage() {
  const t = useTranslations("invoices_page");
  const locale = useLocale();
  // Filtrování podle aktivního profilu — useSyncData() automaticky řeší
  // soft-delete + match na profileSyncId, a reaguje na přepnutí profilu
  // (event "cointrack:profile-changed").
  const { loading, error, profileSyncId, entitiesByProfile, reload } = useSyncData();
  const allInvoices = entitiesByProfile<InvoiceData>("invoices");
  const accounts = entitiesByProfile<ServerAccount>("accounts");

  // Pro PERSONAL profil schováme iDoklad-imported faktury (mají idokladId nebo
  // source="idoklad"). Tyhle se nepatří do osobního profilu — vznikly z bugu
  // ve starších verzích, kdy iDoklad fungoval globálně místo per-profile.
  // Data zůstávají v DB (nejsou smazaná), jen se nezobrazují tady.
  const activeProfileType = useMemo(() => {
    return getCachedProfileType(getCurrentProfileSyncId());
  }, [profileSyncId]);
  const invoices = useMemo(() => {
    if (activeProfileType !== "PERSONAL") return allInvoices;
    return allInvoices.filter((inv) => {
      const d = inv.data;
      const hasIDokladId = d.idokladId != null && d.idokladId !== "" && d.idokladId !== "0";
      const fromIDoklad = d.source === "idoklad";
      return !hasIDokladId && !fromIDoklad;
    });
  }, [allInvoices, activeProfileType]);

  // Search v sessionStorage — přežívá navigaci na detail faktury a zpět.
  const [query, setQuery] = useState(() => getPersistedSearch("invoices"));
  useEffect(() => { setPersistedSearch("invoices", query); }, [query]);

  const [filter, setFilter] = useState<"ALL" | "RECEIVED" | "ISSUED">("ALL");
  const [paidFilter, setPaidFilter] = useState<"ALL" | "PAID" | "UNPAID">("ALL");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [period, setPeriod] = useState<Period>("all");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [creating, setCreating] = useState(false);
  // Multi-select pro hromadný export Pohoda XML / delete
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Lookup mapy pro fulltext search (název účtu).
  const accountNameMap = useMemo(() => {
    const m = new Map<string, string>();
    accounts.forEach((a) => m.set(a.syncId, a.data.name));
    return m;
  }, [accounts]);

  // Map: account syncId → account.type — pro detekci CASH účtu při filtru.
  const accountTypeMap = useMemo(() => {
    const m = new Map<string, string>();
    accounts.forEach((a) => m.set(a.syncId, (a.data.type ?? "").toUpperCase()));
    return m;
  }, [accounts]);

  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);

  // Detekce existujících duplicit v rámci profilu — počítáno *před* aplikací
  // UI filtrů (datum/typ/uhrazeno), aby badge svítil i tehdy, když je
  // partner v jiném zobrazení. Save-time check (v InvoiceEditor) brání
  // dalšímu vzniku, tohle slouží k úklidu starých dupů.
  const dupNumbers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of invoices) {
      const n = (r.data.invoiceNumber ?? "").trim();
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    const result = new Set<string>();
    counts.forEach((c, n) => {
      if (c > 1) result.add(n);
    });
    return result;
  }, [invoices]);

  const filtered = useMemo(() => {
    const ql = query.trim().toLowerCase();
    const qAmount = ql ? parseFloat(ql.replace(/[\s ]/g, "").replace(",", ".")) : NaN;
    const hasAmountQuery = Number.isFinite(qAmount);
    // Numerický dotaz (např. VS '6042026') = exact match na invoiceNumber +
    // variableSymbol; jinak by '6042026' nahodile matchnulo i fakturu '6032026'
    // s popiskou obsahující datum 6.4.2026.
    const isNumericQuery = /^\d+$/.test(ql);

    return [...invoices]
      .filter((r) => {
        if (filter === "RECEIVED") return r.data.isExpense;
        if (filter === "ISSUED") return !r.data.isExpense;
        return true;
      })
      .filter((r) => {
        if (paidFilter === "ALL") return true;
        const isPaid = r.data.paid || !!r.data.linkedTransactionId;
        return paidFilter === "PAID" ? isPaid : !isPaid;
      })
      .filter((r) => {
        const d = r.data.issueDate;
        if (!d) return !range.from && !range.to;
        if (range.from && d < range.from) return false;
        if (range.to && d > range.to) return false;
        return true;
      })
      .filter((r) => {
        if (accountFilter === "ALL") return true;
        const linked = r.data.linkedAccountId;
        const isCashPayment = (r.data.paymentMethod ?? "").toUpperCase() === "CASH";
        if (accountFilter === "CASH") {
          if (isCashPayment) return true;
          if (linked && accountTypeMap.get(linked) === "CASH") return true;
          return false;
        }
        if (linked === accountFilter) return true;
        if (!linked && isCashPayment && accountTypeMap.get(accountFilter) === "CASH") return true;
        return false;
      })
      .filter((r) => {
        if (!ql) return true;
        const d = r.data;

        if (isNumericQuery) {
          if (d.invoiceNumber === ql) return true;
          if (d.variableSymbol === ql) return true;
          if (hasAmountQuery && Math.abs(parseFloat(String(d.totalWithVat ?? "0")) - qAmount) < 0.01) return true;
          if (d.issueDate?.includes(ql)) return true;
          if (d.dueDate?.includes(ql)) return true;
          return false;
        }

        // Textový dotaz — substring přes všechna pole
        if (d.invoiceNumber?.toLowerCase().includes(ql)) return true;
        if (d.variableSymbol?.toLowerCase().includes(ql)) return true;
        if (d.supplierName?.toLowerCase().includes(ql)) return true;
        if (d.customerName?.toLowerCase().includes(ql)) return true;
        if (d.currency?.toLowerCase().includes(ql)) return true;

        const accName = d.linkedAccountId ? accountNameMap.get(d.linkedAccountId) : undefined;
        if (accName?.toLowerCase().includes(ql)) return true;

        if (d.issueDate?.includes(ql)) return true;
        if (d.dueDate?.includes(ql)) return true;
        if (hasAmountQuery && Math.abs(parseFloat(String(d.totalWithVat ?? "0")) - qAmount) < 0.01) return true;

        return false;
      })
      .sort((a, b) => (b.data.issueDate ?? "").localeCompare(a.data.issueDate ?? ""));
  }, [invoices, query, filter, paidFilter, range, accountFilter, accountNameMap, accountTypeMap]);

  // ─── Multi-select pro hromadné akce ────────────────────────────────────

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.syncId));

  function toggleOne(syncId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(syncId)) next.delete(syncId);
      else next.add(syncId);
      return next;
    });
  }

  function toggleAllVisible() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((r) => next.delete(r.syncId));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((r) => next.add(r.syncId));
        return next;
      });
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(t("bulk_delete_confirm", { count: selected.size }))) return;
    setBulkBusy(true);
    try {
      const now = new Date().toISOString();
      const entities = invoices
        .filter((r) => selected.has(r.syncId))
        .map((r) => ({
          syncId: r.syncId,
          updatedAt: now,
          deletedAt: now,
          clientVersion: 1,
          data: r.data as unknown as Record<string, unknown>,
        }));
      await withAuth((tk) => sync.push(tk, { entities: { invoices: entities } }));
      setSelected(new Set());
      await reload();
    } catch (e) {
      alert(`${t("bulk_delete_failed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkBusy(false);
    }
  }

  const selectedIdsArray = useMemo(() => Array.from(selected), [selected]);

  /** Soft-delete jedné faktury — push sync s deletedAt = now. */
  async function deleteOne(syncId: string) {
    const entity = invoices.find((r) => r.syncId === syncId);
    if (!entity) return;
    if (!confirm(t("delete_one_confirm", { number: entity.data.invoiceNumber || "?" }))) return;
    try {
      const now = new Date().toISOString();
      await withAuth((tk) =>
        sync.push(tk, {
          entities: {
            invoices: [
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
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Hromadné smazání duplicit: pro každé duplicitní číslo zachová JEDNU
   * kopii a smaže ostatní (soft-delete).
   *
   * Která zůstane (priorita pro keep):
   *   1. ta s `linkedTransactionId` (= napojená na platbu, nejcennější)
   *   2. ta s `paid = true`
   *   3. nejstarší podle issueDate (chronologicky první v sérii)
   *   4. tie-breaker: nejmenší syncId (deterministické)
   */
  async function deleteDuplicates() {
    // 1) seskupit podle čísla
    const groups = new Map<string, typeof invoices>();
    for (const r of invoices) {
      const n = (r.data.invoiceNumber ?? "").trim();
      if (!n) continue;
      const arr = groups.get(n) ?? [];
      arr.push(r);
      groups.set(n, arr);
    }

    // 2) v každé skupině >1 vybrat jednoho keepera, ostatní označit pro delete
    const toDelete: typeof invoices = [];
    groups.forEach((group) => {
      if (group.length <= 1) return;
      const sorted = [...group].sort((a, b) => {
        const al = a.data.linkedTransactionId ? 1 : 0;
        const bl = b.data.linkedTransactionId ? 1 : 0;
        if (al !== bl) return bl - al;
        const ap = a.data.paid ? 1 : 0;
        const bp = b.data.paid ? 1 : 0;
        if (ap !== bp) return bp - ap;
        const ad = a.data.issueDate ?? "";
        const bd = b.data.issueDate ?? "";
        if (ad !== bd) return ad.localeCompare(bd);
        return a.syncId.localeCompare(b.syncId);
      });
      toDelete.push(...sorted.slice(1));
    });

    if (toDelete.length === 0) return;
    if (!confirm(t("dup_delete_confirm", { count: toDelete.length }))) return;

    try {
      const now = new Date().toISOString();
      const entities = toDelete.map((r) => ({
        syncId: r.syncId,
        updatedAt: now,
        deletedAt: now,
        clientVersion: 1,
        data: r.data as unknown as Record<string, unknown>,
      }));
      await withAuth((tk) => sync.push(tk, { entities: { invoices: entities } }));
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

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
          <ExportButton
            type="invoices"
            profileSyncId={profileSyncId}
            selectedIds={selectedIdsArray}
          />
          <button
            onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            {t("new_invoice")}
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <input
          type="text"
          placeholder={t("search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[14rem] h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm">
          {(["ALL", "RECEIVED", "ISSUED"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 ${
                filter === f ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {f === "ALL" ? t("filter_all") : f === "RECEIVED" ? t("filter_received") : t("filter_issued")}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm">
          {(["ALL", "PAID", "UNPAID"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setPaidFilter(f)}
              className={`px-4 py-2 ${
                paidFilter === f ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {f === "ALL" ? t("filter_all") : f === "PAID" ? t("filter_paid") : t("filter_unpaid")}
            </button>
          ))}
        </div>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">{t("filter_account_all")}</option>
          <option value="CASH">{t("filter_cash_only")}</option>
          <option disabled>──────────</option>
          {accounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>{a.data.name}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {dupNumbers.size > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex items-center justify-between gap-3 flex-wrap">
          <span className="flex-1 min-w-[16rem]">{t("dup_warning", { count: dupNumbers.size })}</span>
          <button
            type="button"
            onClick={deleteDuplicates}
            className="shrink-0 h-9 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
          >
            {t("dup_delete_button")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">📄</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          {selected.size > 0 && (
            <div className="bg-brand-50 border-b border-brand-200 px-4 py-2 flex items-center gap-3 flex-wrap">
              <span className="text-sm text-brand-900 font-medium">
                {t("bulk_selected_count", { count: selected.size })}
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs text-brand-700 hover:text-brand-900 underline"
              >
                {t("bulk_clear")}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={bulkDelete}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {bulkBusy ? t("bulk_deleting") : t("bulk_delete")}
              </button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllVisible}
                    aria-label={t("bulk_select_all")}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-6 py-3 font-medium">{t("th_number")}</th>
                <th className="px-6 py-3 font-medium">{t("th_partner")}</th>
                <th className="px-6 py-3 font-medium">{t("th_date")}</th>
                <th className="px-6 py-3 font-medium">{t("th_type")}</th>
                <th className="px-6 py-3 font-medium">{t("th_status")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_amount")}</th>
                <th className="px-3 py-3 font-medium w-1" aria-label="" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((r) => {
                const isSel = selected.has(r.syncId);
                return (
                <tr
                  key={r.syncId}
                  className={`hover:bg-ink-50/50 cursor-pointer ${isSel ? "bg-brand-50/40" : ""}`}
                  onClick={() => { window.location.href = `/app/invoices/${r.syncId}`; }}
                >
                  <td
                    className="px-3 py-3 w-8"
                    onClick={(e) => { e.stopPropagation(); toggleOne(r.syncId); }}
                  >
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleOne(r.syncId)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("bulk_select_one")}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-3 font-medium text-ink-900 tabular-nums">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{r.data.invoiceNumber || "—"}</span>
                      {r.data.invoiceNumber &&
                        dupNumbers.has(r.data.invoiceNumber.trim()) && (
                          <span
                            className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium whitespace-nowrap"
                            title={t("dup_badge_tooltip")}
                          >
                            {t("dup_badge")}
                          </span>
                        )}
                      {r.data.exportedAt && (
                        <span
                          className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium whitespace-nowrap"
                          title={t("exported_tooltip", { date: r.data.exportedAt.slice(0, 10) })}
                        >
                          {t("exported_badge")}
                        </span>
                      )}
                      {r.data.source === "email" && (
                        <span
                          className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium whitespace-nowrap"
                          title={r.data.emailSender ? `Z emailu: ${r.data.emailSender}` : "Z emailu"}
                        >
                          📧 Email
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-ink-700 max-w-xs truncate">
                    {r.data.isExpense
                      ? r.data.supplierName || "—"
                      : r.data.customerName || "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-600">{r.data.issueDate || "—"}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-block text-[10px] uppercase px-1.5 py-0.5 rounded ${
                        r.data.isExpense
                          ? "bg-red-100 text-red-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {r.data.isExpense ? t("type_received") : t("type_issued")}
                    </span>
                  </td>
                  <td className="px-6 py-3">
                    {r.data.paid || r.data.linkedTransactionId ? (
                      <span className="text-emerald-700 text-xs font-medium">{t("status_paid")}</span>
                    ) : (
                      <span className="text-ink-500 text-xs">{t("status_unpaid")}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
                    {fmtAmt(r.data.totalWithVat, r.data.currency ?? "CZK", locale)}
                  </td>
                  <td
                    className="px-3 py-3 whitespace-nowrap text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link
                      href={`/app/invoices/${r.syncId}`}
                      title={t("edit_action")}
                      aria-label={t("edit_action")}
                      className="inline-flex items-center justify-center p-2 rounded-lg text-ink-500 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteOne(r.syncId)}
                      title={t("delete_action")}
                      aria-label={t("delete_action")}
                      className="inline-flex items-center justify-center p-2 rounded-lg text-ink-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <InvoiceEditor
          initial={null}
          initialItems={[]}
          rawItemEntities={[]}
          profileSyncId={profileSyncId}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onSaved={async (syncId) => {
            setCreating(false);
            await reload();
            window.location.href = `/app/invoices/${syncId}`;
          }}
        />
      )}
    </div>
  );
}

function fmtAmt(amount: string | number | undefined, currency: string, locale: string = "cs-CZ"): string {
  const n = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}
