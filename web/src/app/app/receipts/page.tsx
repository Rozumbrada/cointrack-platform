"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import {
  Period,
  PeriodSelector,
  periodRange,
} from "@/components/app/PeriodSelector";
import { ExportButton } from "@/components/app/ExportButton";

interface ReceiptData {
  profileId?: string;
  categoryId?: string;
  transactionId?: string;     // = "spárováno s tx" (server NEPOSÍLÁ linkedTransactionId)
  merchantName?: string;
  date: string;
  time?: string;
  totalWithVat: string;       // server posílá string
  totalWithoutVat?: string;
  currency?: string;
  paymentMethod?: string;
  note?: string;              // ne 'notes'!
  photoKeys?: unknown;        // array, server posílá JSON
  linkedAccountId?: string;
}

type AccountListEntry = { syncId: string; data: ServerAccount };

export default function ReceiptsPage() {
  const t = useTranslations("receipts_page");
  const locale = useLocale();
  // Filtrování podle aktivního profilu — v hook entitiesByProfile() dělá:
  //   1) skip soft-deleted (e.deletedAt + e.data.deletedAt)
  //   2) match e.data.profileId === activeProfileSyncId
  // Přepnutí profilu se promítne automaticky přes "cointrack:profile-changed" listener.
  const { loading, error, profileSyncId, entitiesByProfile, reload } = useSyncData();
  const receipts = entitiesByProfile<ReceiptData>("receipts");
  const accounts = entitiesByProfile<ServerAccount>("accounts");

  const [query, setQuery] = useState("");
  const [linkFilter, setLinkFilter] = useState<"ALL" | "LINKED" | "UNLINKED">("ALL");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [creating, setCreating] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });

  const range = useMemo(() => periodRange(period, customRange), [period, customRange]);

  const filtered = useMemo(() => {
    return [...receipts]
      .filter((r) => {
        if (linkFilter === "ALL") return true;
        const linked = !!r.data.transactionId;
        return linkFilter === "LINKED" ? linked : !linked;
      })
      .filter((r) => {
        const d = r.data.date;
        if (!d) return !range.from && !range.to;
        if (range.from && d < range.from) return false;
        if (range.to && d > range.to) return false;
        return true;
      })
      .filter((r) =>
        accountFilter === "ALL" ? true : r.data.linkedAccountId === accountFilter,
      )
      .filter((r) =>
        query ? r.data.merchantName?.toLowerCase().includes(query.toLowerCase()) : true,
      )
      .sort((a, b) => (b.data.date ?? "").localeCompare(a.data.date ?? ""));
  }, [receipts, query, linkFilter, range, accountFilter]);

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
          <ExportButton type="receipts" profileSyncId={profileSyncId} />
          <button
            onClick={() => setCreating(true)}
            className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            {t("new_receipt")}
          </button>
        </div>
      </div>

      {creating && profileSyncId && (
        <ReceiptCreateDialog
          profileSyncId={profileSyncId}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onSaved={async () => {
            setCreating(false);
            await reload();
          }}
        />
      )}

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <input
          type="text"
          placeholder={t("search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[14rem] h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <div className="flex rounded-lg border border-ink-300 bg-white overflow-hidden text-sm">
          {(["ALL", "LINKED", "UNLINKED"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setLinkFilter(f)}
              className={`px-4 py-2 ${
                linkFilter === f ? "bg-brand-50 text-brand-700" : "text-ink-700 hover:bg-ink-50"
              }`}
            >
              {f === "ALL" ? t("filter_all") : f === "LINKED" ? t("filter_linked") : t("filter_unlinked")}
            </button>
          ))}
        </div>
        <select
          value={accountFilter}
          onChange={(e) => setAccountFilter(e.target.value)}
          className="h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="ALL">{t("filter_account_all")}</option>
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

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_merchant")}</th>
                <th className="px-6 py-3 font-medium">{t("th_date")}</th>
                <th className="px-6 py-3 font-medium">{t("th_payment")}</th>
                <th className="px-6 py-3 font-medium">{t("th_photos")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filtered.map((r) => {
                const photos = Array.isArray(r.data.photoKeys) ? r.data.photoKeys : [];
                return (
                  <tr
                    key={r.syncId}
                    className="hover:bg-ink-50/50 cursor-pointer"
                    onClick={() => { window.location.href = `/app/receipts/${r.syncId}`; }}
                  >
                    <td className="px-6 py-3 font-medium text-ink-900">
                      {r.data.merchantName || t("no_name")}
                    </td>
                    <td className="px-6 py-3 text-ink-600 whitespace-nowrap">
                      {r.data.date || "—"}
                      {r.data.time && <span className="text-ink-400 text-xs"> {r.data.time}</span>}
                    </td>
                    <td className="px-6 py-3 text-ink-600">{labelPayment(r.data.paymentMethod, t)}</td>
                    <td className="px-6 py-3 text-ink-600 text-xs">
                      {photos.length > 0 ? `📷 ${photos.length}` : "—"}
                    </td>
                    <td className="px-6 py-3 text-right font-semibold tabular-nums text-ink-900">
                      {fmtAmt(r.data.totalWithVat, r.data.currency ?? "CZK", locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

function labelPayment(p: string | undefined | null, t: (k: string) => string): string {
  switch (p) {
    case "CASH": return t("payment_cash");
    case "CARD": return t("payment_card");
    default: return "—";
  }
}

// ─── Create dialog ─────────────────────────────────────────────────────

function ReceiptCreateDialog({
  profileSyncId,
  accounts,
  onClose,
  onSaved,
}: {
  profileSyncId: string;
  accounts: AccountListEntry[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("receipts_page");
  const [merchantName, setMerchantName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalWithVat, setTotalWithVat] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [linkedAccountId, setLinkedAccountId] = useState<string>("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ReceiptData | null>(null);

  async function save(force = false) {
    if (!merchantName.trim()) return setErr(t("fill_merchant"));
    if (!totalWithVat.trim()) return setErr(t("fill_amount"));

    setSaving(true);
    setErr(null);
    try {
      // Duplicate check (client-side)
      if (!force) {
        const res = await withAuth((t) => sync.pull(t));
        const totalNum = parseFloat(totalWithVat.replace(",", "."));
        const dupEntity = (res.entities["receipts"] ?? []).find((e) => {
          if (e.deletedAt) return false;
          const d = e.data as unknown as ReceiptData;
          if (d.profileId !== profileSyncId) return false;
          if (d.date !== date) return false;
          const dt = parseFloat(String(d.totalWithVat));
          if (Math.abs(dt - totalNum) > 0.01) return false;
          return (d.merchantName ?? "").trim().toLowerCase() ===
            merchantName.trim().toLowerCase();
        });
        if (dupEntity) {
          setDuplicate(dupEntity.data as unknown as ReceiptData);
          setSaving(false);
          return;
        }
      }

      const now = new Date().toISOString();
      const syncId = crypto.randomUUID();
      const data: Record<string, unknown> = {
        profileId: profileSyncId,
        merchantName: merchantName.trim(),
        date,
        totalWithVat: totalWithVat.replace(",", "."),
        currency: "CZK",
        paymentMethod,
        linkedAccountId: linkedAccountId || undefined,
        note: note.trim() || undefined,
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            receipts: [
              { syncId, updatedAt: now, clientVersion: 1, data },
            ],
          },
        }),
      );
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-ink-200 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-ink-200 flex items-center justify-between">
          <h2 className="font-semibold text-ink-900">{t("dialog_title")}</h2>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-900">✕</button>
        </div>
        <div className="p-6 space-y-4">
          {duplicate && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm space-y-2">
              <div className="font-medium text-amber-900">{t("dup_title")}</div>
              <div className="text-amber-800">
                {t("dup_desc", { merchant: duplicate.merchantName ?? "", date: duplicate.date, amount: String(duplicate.totalWithVat) })}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setDuplicate(null); save(true); }}
                  className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
                >
                  {t("dup_save_anyway")}
                </button>
                <button
                  onClick={() => setDuplicate(null)}
                  className="px-3 py-1.5 rounded border border-amber-300 text-amber-800 text-xs"
                >
                  {t("dup_cancel")}
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">{t("field_merchant")}</label>
            <input
              type="text"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              autoFocus
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("field_date")}</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("field_payment")}</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              >
                <option value="CASH">{t("payment_cash")}</option>
                <option value="CARD">{t("payment_card")}</option>
                <option value="UNKNOWN">{t("payment_transfer")}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("field_total")}</label>
              <input
                type="text"
                value={totalWithVat}
                onChange={(e) => setTotalWithVat(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("field_account")}</label>
              <select
                value={linkedAccountId}
                onChange={(e) => setLinkedAccountId(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              >
                <option value="">{t("account_unassigned")}</option>
                {accounts.map((a) => (
                  <option key={a.syncId} value={a.syncId}>{a.data.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">{t("field_note")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm"
            />
          </div>
          {err && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
              {err}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-ink-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-ink-300 text-sm text-ink-700 hover:bg-ink-50"
            disabled={saving}
          >
            {t("cancel")}
          </button>
          <button
            onClick={() => save(false)}
            className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium disabled:opacity-50"
            disabled={saving}
          >
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
