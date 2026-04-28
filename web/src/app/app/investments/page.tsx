"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import { FormDialog, Field, inputClass } from "@/components/app/FormDialog";

interface InvestmentPositionData {
  profileId: string;
  accountId: string;
  symbol: string;
  name: string;
  /** Server posílá string. */
  quantity: string;
  buyPrice: string;
  buyCurrency: string;
  buyDate: string;
  platform: string;
  isOpen: boolean;
  sellPrice?: string;
  sellDate?: string;
  yahooSymbol?: string;
  notes?: string;
  /** Web extension: Yahoo Finance refresh ukládá lokálně, neukládá se na server. */
  currentPrice?: number;
}

type PositionRow = { syncId: string; data: InvestmentPositionData };

export default function InvestmentsPage() {
  const t = useTranslations("investments_page");
  const locale = useLocale();
  const { loading, error, entitiesByProfile, profileSyncId, reload } = useSyncData();
  const positions = entitiesByProfile<InvestmentPositionData>("investment_positions");
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const [editing, setEditing] = useState<PositionRow | "new" | null>(null);

  const accMap = useMemo(() => {
    const m = new Map<string, ServerAccount>();
    accounts.forEach((a) => m.set(a.syncId, a.data));
    return m;
  }, [accounts]);

  const sorted = useMemo(
    () => [...positions].sort((a, b) => a.data.symbol.localeCompare(b.data.symbol)),
    [positions],
  );

  const totals = useMemo(() => {
    let cost = 0;
    let value = 0;
    for (const p of positions) {
      if (!p.data.isOpen) continue;
      const qty = parseFloat(p.data.quantity) || 0;
      const buy = parseFloat(p.data.buyPrice) || 0;
      const cur = p.data.currentPrice ?? buy;
      cost += qty * buy;
      value += qty * cur;
    }
    return { cost, value, pnl: value - cost };
  }, [positions]);

  async function onDelete(row: PositionRow) {
    if (!confirm(t("delete_confirm", { symbol: row.data.symbol }))) return;
    const now = new Date().toISOString();
    await withAuth((t) =>
      sync.push(t, {
        entities: {
          investment_positions: [
            {
              syncId: row.syncId,
              updatedAt: now,
              deletedAt: now,
              clientVersion: 1,
              data: row.data as unknown as Record<string, unknown>,
            },
          ],
        },
      }),
    );
    reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
          <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="h-10 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
        >
          {t("new_position")}
        </button>
      </div>

      {sorted.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Tile label={t("tile_cost")} value={fmt(totals.cost, "CZK", locale)} />
          <Tile label={t("tile_value")} value={fmt(totals.value, "CZK", locale)} />
          <Tile
            label={t("tile_pnl")}
            value={(totals.pnl >= 0 ? "+" : "") + fmt(totals.pnl, "CZK", locale)}
            color={totals.pnl >= 0 ? "text-emerald-700" : "text-red-700"}
          />
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          {t("error_prefix")} {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>
      ) : sorted.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-200 p-12 text-center">
          <div className="text-4xl mb-3">📈</div>
          <div className="font-medium text-ink-900">{t("empty_title")}</div>
          <p className="text-sm text-ink-600 mt-2">{t("empty_desc")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_symbol")}</th>
                <th className="px-6 py-3 font-medium">{t("th_account")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_quantity")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_buy")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_current")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_pnl")}</th>
                <th className="px-6 py-3 w-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {sorted.map((p) => {
                const qty = parseFloat(p.data.quantity) || 0;
                const buy = parseFloat(p.data.buyPrice) || 0;
                const cur = p.data.currentPrice ?? buy;
                const pnl = (cur - buy) * qty;
                const pnlPct = buy > 0 ? ((cur - buy) / buy) * 100 : 0;
                const acc = p.data.accountId ? accMap.get(p.data.accountId) : undefined;
                return (
                  <tr key={p.syncId} className={`hover:bg-ink-50/50 group ${!p.data.isOpen ? "opacity-50" : ""}`}>
                    <td className="px-6 py-3 font-medium text-ink-900">
                      <div className="flex items-center gap-2">
                        {p.data.symbol}
                        {!p.data.isOpen && (
                          <span className="text-[10px] uppercase bg-ink-100 text-ink-600 px-1.5 py-0.5 rounded">
                            {t("closed")}
                          </span>
                        )}
                      </div>
                      {p.data.name && (
                        <div className="text-xs text-ink-500 font-normal">{p.data.name}</div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-ink-600">{acc?.name ?? "—"}</td>
                    <td className="px-6 py-3 text-right tabular-nums">{qty.toLocaleString(locale)}</td>
                    <td className="px-6 py-3 text-right tabular-nums text-ink-600">
                      {fmt(buy, p.data.buyCurrency, locale)}
                    </td>
                    <td className="px-6 py-3 text-right tabular-nums">
                      {fmt(cur, p.data.buyCurrency, locale)}
                    </td>
                    <td
                      className={`px-6 py-3 text-right tabular-nums font-semibold ${
                        pnl >= 0 ? "text-emerald-700" : "text-red-700"
                      }`}
                    >
                      {pnl >= 0 ? "+" : ""}
                      {fmt(pnl, p.data.buyCurrency, locale)}
                      <div className="text-xs font-normal">
                        {pnl >= 0 ? "+" : ""}
                        {pnlPct.toFixed(1)} %
                      </div>
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                        <button
                          onClick={() => setEditing(p)}
                          className="text-ink-500 hover:text-ink-700 px-2"
                          title={t("edit")}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => onDelete(p)}
                          className="text-red-500 hover:text-red-700 px-2"
                          title={t("delete")}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <PositionEditor
          initial={editing === "new" ? null : editing}
          profileSyncId={profileSyncId}
          accounts={accounts}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function PositionEditor({
  initial,
  profileSyncId,
  accounts,
  onClose,
  onSaved,
}: {
  initial: PositionRow | null;
  profileSyncId: string | null;
  accounts: Array<{ syncId: string; data: ServerAccount }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("investments_page");
  const investmentAccs = useMemo(
    () => accounts.filter((a) => a.data.type === "INVESTMENT" || a.data.type === "investment" || true),
    [accounts],
  );

  const [symbol, setSymbol] = useState(initial?.data.symbol ?? "");
  const [name, setName] = useState(initial?.data.name ?? "");
  const [quantity, setQuantity] = useState(initial?.data.quantity ?? "");
  const [buyPrice, setBuyPrice] = useState(initial?.data.buyPrice ?? "");
  const [buyCurrency, setBuyCurrency] = useState(initial?.data.buyCurrency ?? "USD");
  const [buyDate, setBuyDate] = useState(initial?.data.buyDate ?? new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState(initial?.data.accountId ?? investmentAccs[0]?.syncId ?? "");
  const [platform, setPlatform] = useState(initial?.data.platform ?? "Manual");
  const [yahooSymbol, setYahooSymbol] = useState(initial?.data.yahooSymbol ?? "");
  const [isOpen, setIsOpen] = useState(initial?.data.isOpen ?? true);
  const [sellPrice, setSellPrice] = useState(initial?.data.sellPrice ?? "");
  const [sellDate, setSellDate] = useState(initial?.data.sellDate ?? "");
  const [notes, setNotes] = useState(initial?.data.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!profileSyncId) return setErr(t("no_profile"));
    if (!symbol.trim()) return setErr(t("fill_ticker"));
    if (!accountId) return setErr(t("fill_account"));
    const qty = parseFloat(quantity.replace(",", "."));
    if (!qty || qty <= 0) return setErr(t("fill_qty"));
    const buy = parseFloat(buyPrice.replace(",", "."));
    if (!buy || buy <= 0) return setErr(t("fill_buy_price"));

    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const data: InvestmentPositionData = {
        profileId: profileSyncId,
        accountId,
        symbol: symbol.trim().toUpperCase(),
        name: name.trim() || symbol.trim().toUpperCase(),
        quantity: qty.toString(),
        buyPrice: buy.toFixed(4),
        buyCurrency,
        buyDate,
        platform,
        isOpen,
        sellPrice: !isOpen && sellPrice ? parseFloat(sellPrice.replace(",", ".")).toFixed(4) : undefined,
        sellDate: !isOpen ? sellDate || undefined : undefined,
        yahooSymbol: yahooSymbol.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            investment_positions: [
              {
                syncId: initial?.syncId ?? crypto.randomUUID(),
                updatedAt: now,
                clientVersion: 1,
                data: data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormDialog
      title={initial ? t("editor_edit") : t("editor_new")}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("field_ticker")}>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="AAPL"
            autoFocus
            className={inputClass}
          />
        </Field>
        <Field label={t("field_yahoo")}>
          <input
            type="text"
            value={yahooSymbol}
            onChange={(e) => setYahooSymbol(e.target.value)}
            placeholder={symbol || "AAPL"}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label={t("field_company")}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Apple Inc."
          className={inputClass}
        />
      </Field>
      <Field label={t("field_account")}>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
          {accounts.map((a) => (
            <option key={a.syncId} value={a.syncId}>
              {a.data.name} ({a.data.currency})
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("field_qty")}>
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("field_unit_price")}>
          <input
            type="text"
            inputMode="decimal"
            value={buyPrice}
            onChange={(e) => setBuyPrice(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("field_currency")}>
          <select value={buyCurrency} onChange={(e) => setBuyCurrency(e.target.value)} className={inputClass}>
            {["USD", "EUR", "CZK", "GBP", "CHF"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("field_buy_date")}>
          <input type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label={t("field_platform")}>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={inputClass}>
            {["Manual", "XTB", "Degiro", "IBKR", "Trading 212", "Revolut", "eToro"].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} className="w-4 h-4" />
        {t("is_open")}
      </label>
      {!isOpen && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("field_sell_price")}>
            <input
              type="text"
              inputMode="decimal"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t("field_sell_date")}>
            <input type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} className={inputClass} />
          </Field>
        </div>
      )}
      <Field label={t("field_note")}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={`${inputClass} h-auto py-2`}
        />
      </Field>
    </FormDialog>
  );
}

function Tile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-ink-200 p-5">
      <div className="text-xs font-medium text-ink-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${color ?? "text-ink-900"}`}>{value}</div>
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
