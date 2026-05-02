"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { sync, api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";

interface ReceiptData {
  profileId?: string;
  categoryId?: string;
  transactionId?: string;
  merchantName?: string;
  merchantIco?: string;
  merchantDic?: string;
  merchantStreet?: string;
  merchantCity?: string;
  merchantZip?: string;
  date: string;
  time?: string;
  totalWithVat: string | number;
  totalWithoutVat?: string | number;
  currency?: string;
  paymentMethod?: string;
  note?: string;
  photoKeys?: string[];
  linkedAccountId?: string;
}

interface AccountListEntry {
  syncId: string;
  data: { name: string; type?: string };
}

interface ReceiptItemData {
  receiptId: string;
  name: string;
  quantity?: string | number;
  unitPrice?: string | number;
  totalPrice: string | number;
  vatRate?: string | number;
  position?: number;
}

export default function ReceiptDetailPage() {
  const router = useRouter();
  const t = useTranslations("receipt_detail");
  const params = useParams<{ syncId: string }>();
  const { loading, error, entitiesByProfile, rawEntities, reload } = useSyncData();

  const allReceipts = entitiesByProfile<ReceiptData>("receipts");
  const allItems = rawEntities("receipt_items");
  const allAccounts = entitiesByProfile<AccountListEntry["data"]>("accounts");
  const allTransactions = entitiesByProfile<{
    amount: string | number;
    type: string;
    accountId?: string;
    dateTime?: string;
  }>("transactions");

  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);

  const receipt = useMemo(
    () => allReceipts.find((r) => r.syncId === params.syncId),
    [allReceipts, params.syncId],
  );

  const items = useMemo(() => {
    if (!receipt) return [];
    return allItems
      .filter((e) => {
        const d = e.data as Record<string, unknown>;
        return d.receiptId === receipt.syncId;
      })
      .map((e) => ({ syncId: e.syncId, data: e.data as unknown as ReceiptItemData }))
      .sort((a, b) => (a.data.position ?? 0) - (b.data.position ?? 0));
  }, [allItems, receipt]);

  async function onFindAndLink() {
    if (!receipt) return;
    setLinking(true);
    try {
      const r = receipt.data;
      const total = parseFloat(String(r.totalWithVat));
      const baseDate = new Date(r.date);
      // Najdi transakci s ±0.01 Kč shodou částky a ±2 dny od data účtenky
      const match = allTransactions.find((tx) => {
        const amt = parseFloat(String(tx.data.amount));
        if (Math.abs(amt - total) > 0.01) return false;
        if (tx.data.type !== "EXPENSE") return false;
        if (!tx.data.dateTime) return false;
        const txDate = new Date(tx.data.dateTime);
        const diffMs = Math.abs(txDate.getTime() - baseDate.getTime());
        return diffMs <= 2 * 24 * 3600 * 1000;
      });
      if (!match) {
        alert(t("no_match"));
        return;
      }
      const now = new Date().toISOString();
      const updated: Record<string, unknown> = {
        ...(r as unknown as Record<string, unknown>),
        transactionId: match.syncId,
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            receipts: [
              { syncId: receipt.syncId, updatedAt: now, clientVersion: 1, data: updated },
            ],
          },
        }),
      );
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setLinking(false);
    }
  }

  async function onDelete() {
    if (!receipt) return;
    const ok = confirm(t("delete_confirm", { name: receipt.data.merchantName ?? "" }));
    if (!ok) return;
    try {
      const now = new Date().toISOString();
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            receipts: [
              {
                syncId: receipt.syncId,
                updatedAt: now,
                deletedAt: now,
                clientVersion: 1,
                data: receipt.data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      router.push("/app/receipts");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        {t("error_prefix")} {error}
      </div>
    );
  if (!receipt) {
    return (
      <div className="space-y-4">
        <Link href="/app/receipts" className="text-sm text-brand-600 hover:text-brand-700">
          {t("back_short")}
        </Link>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {t("not_found", { id: params.syncId })}
        </div>
      </div>
    );
  }

  const r = receipt.data;
  const currency = r.currency ?? "CZK";
  const photoKeys = Array.isArray(r.photoKeys) ? r.photoKeys : [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <Link href="/app/receipts" className="text-sm text-brand-600 hover:text-brand-700">
          {t("back")}
        </Link>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-brand-700 hover:text-brand-800"
          >
            {t("edit")}
          </button>
          <button onClick={onDelete} className="text-sm text-red-600 hover:text-red-700">
            {t("delete")}
          </button>
        </div>
      </div>

      {editing && (
        <ReceiptEditDialog
          receipt={receipt}
          accounts={allAccounts}
          onClose={() => setEditing(false)}
          onSaved={async () => { setEditing(false); await reload(); }}
        />
      )}

      <header className="bg-white rounded-2xl border border-ink-200 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">
              {r.merchantName || t("no_name")}
            </h1>
            <p className="text-sm text-ink-600 mt-1">
              {r.date}
              {r.time && <span> · {r.time}</span>}
            </p>
            {r.transactionId ? (
              <p className="text-xs text-emerald-700 mt-1">
                {t("linked_to_tx")}
              </p>
            ) : (
              <button
                onClick={onFindAndLink}
                disabled={linking}
                className="text-xs mt-1 text-brand-700 hover:text-brand-800 disabled:opacity-50"
              >
                {linking ? t("linking") : t("find_link")}
              </button>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-500 uppercase tracking-wide">{t("total")}</div>
            <div className="text-2xl font-semibold text-ink-900 tabular-nums">
              {fmtAmt(r.totalWithVat, currency)}
            </div>
            {r.totalWithoutVat && (
              <div className="text-xs text-ink-500 mt-1">
                {t("without_vat")} {fmtAmt(r.totalWithoutVat, currency)}
              </div>
            )}
          </div>
        </div>

        {(r.paymentMethod || r.merchantIco || r.merchantDic || r.merchantStreet) && (
          <div className="mt-4 pt-4 border-t border-ink-100 grid grid-cols-2 gap-2 text-sm">
            {r.paymentMethod && <Field label={t("payment")} value={labelPayment(r.paymentMethod, t)} />}
            {r.merchantIco && <Field label={t("merchant_ico")} value={r.merchantIco} />}
            {r.merchantDic && <Field label={t("merchant_dic")} value={r.merchantDic} />}
            {r.merchantStreet && <Field label={t("merchant_street")} value={r.merchantStreet} />}
            {(r.merchantCity || r.merchantZip) && (
              <Field
                label={t("merchant_city")}
                value={[r.merchantZip, r.merchantCity].filter(Boolean).join(" ")}
              />
            )}
          </div>
        )}
      </header>

      {photoKeys.length > 0 && (
        <ReceiptPhotos keys={photoKeys} />
      )}

      {items.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-ink-200">
            <h2 className="font-semibold text-ink-900">{t("items")}</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">{t("th_name")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_qty")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_unit_price")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_vat")}</th>
                <th className="px-6 py-3 font-medium text-right">{t("th_total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {items.map((i) => (
                <tr key={i.syncId}>
                  <td className="px-6 py-3 text-ink-900">{i.data.name}</td>
                  <td className="px-6 py-3 text-ink-600 text-right tabular-nums">
                    {fmtNum(i.data.quantity)}
                  </td>
                  <td className="px-6 py-3 text-ink-600 text-right tabular-nums">
                    {i.data.unitPrice != null ? fmtAmt(i.data.unitPrice, currency) : "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-600 text-right tabular-nums">
                    {i.data.vatRate != null ? `${fmtNum(i.data.vatRate)} %` : "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-900 font-medium text-right tabular-nums">
                    {fmtAmt(i.data.totalPrice, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {r.note && (
        <section className="bg-white rounded-2xl border border-ink-200 p-6">
          <h2 className="font-semibold text-ink-900 mb-2">{t("note")}</h2>
          <p className="text-sm text-ink-700 whitespace-pre-wrap">{r.note}</p>
        </section>
      )}
    </div>
  );
}

// ─── File preview přes presigned URL ──────────────────────────────────

function ReceiptPhotos({ keys }: { keys: string[] }) {
  const t = useTranslations("receipt_detail");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const okMap: Record<string, string> = {};
      const errMap: Record<string, string> = {};
      for (const k of keys) {
        try {
          const res = await withAuth((t) =>
            api<{ downloadUrl: string; expiresIn: number }>(
              `/api/v1/files/download-url?key=${encodeURIComponent(k)}`,
              { token: t },
            ),
          );
          if (res.downloadUrl) okMap[k] = res.downloadUrl;
          else errMap[k] = "prázdná URL";
        } catch (e) {
          errMap[k] = e instanceof Error ? e.message : String(e);
        }
      }
      if (!cancelled) {
        setUrls(okMap);
        setErrors(errMap);
        setDone(true);
      }
    })();
    return () => { cancelled = true; };
  }, [keys]);

  return (
    <section className="bg-white rounded-2xl border border-ink-200 p-6">
      <h2 className="font-semibold text-ink-900 mb-3">{t("photos_title")}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {keys.map((k) => (
          <div key={k} className="aspect-[3/4] bg-ink-100 rounded-lg overflow-hidden">
            {urls[k] ? (
              <a href={urls[k]} target="_blank" rel="noopener">
                <img
                  src={urls[k]}
                  alt={t("photo_alt")}
                  className="w-full h-full object-contain hover:scale-105 transition-transform"
                />
              </a>
            ) : done && errors[k] ? (
              <div className="w-full h-full grid place-items-center p-3 text-center">
                <div>
                  <div className="text-2xl mb-1">⚠️</div>
                  <div className="text-[10px] text-red-700 break-words">{errors[k]}</div>
                  <div className="text-[9px] text-ink-500 break-all mt-1">{k}</div>
                </div>
              </div>
            ) : (
              <div className="w-full h-full grid place-items-center text-ink-400 text-xs">
                {t("loading")}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="text-ink-900 text-sm">{value}</div>
    </div>
  );
}

function fmtAmt(amount: string | number | undefined, currency: string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

function fmtNum(n: string | number | undefined): string {
  const v = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("cs-CZ");
}

function labelPayment(p: string, t: (key: string) => string): string {
  switch (p) {
    case "CASH": return t("payment_cash");
    case "CARD": return t("payment_card");
    default: return p;
  }
}

// ─── Edit dialog ──────────────────────────────────────────────────────

function ReceiptEditDialog({
  receipt,
  accounts,
  onClose,
  onSaved,
}: {
  receipt: { syncId: string; data: ReceiptData };
  accounts: Array<{ syncId: string; data: { name: string; type?: string } }>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("receipt_edit");
  const r = receipt.data;
  const [merchantName, setMerchantName] = useState(r.merchantName ?? "");
  const [date, setDate] = useState(r.date ?? "");
  const [totalWithVat, setTotalWithVat] = useState(String(r.totalWithVat ?? ""));
  const [totalWithoutVat, setTotalWithoutVat] = useState(String(r.totalWithoutVat ?? ""));
  const [paymentMethod, setPaymentMethod] = useState<string>(r.paymentMethod ?? "");
  const [linkedAccountId, setLinkedAccountId] = useState<string>(r.linkedAccountId ?? "");
  const [note, setNote] = useState(r.note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      // null místo undefined → server respektuje explicit clear (containsKey guard).
      const orNull = (v: string) => (v.trim().length > 0 ? v.trim() : null);
      const updated: Record<string, unknown> = {
        ...(r as unknown as Record<string, unknown>),
        merchantName: orNull(merchantName),
        date: date.trim() || r.date,
        totalWithVat: totalWithVat.replace(",", "."),
        totalWithoutVat: totalWithoutVat ? totalWithoutVat.replace(",", ".") : null,
        paymentMethod: paymentMethod || null,
        linkedAccountId: linkedAccountId || null,
        note: orNull(note),
      };
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            receipts: [
              {
                syncId: receipt.syncId,
                updatedAt: now,
                clientVersion: 1,
                data: updated,
              },
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
          <h2 className="font-semibold text-ink-900">{t("title")}</h2>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-900">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">{t("merchant")}</label>
            <input
              type="text"
              value={merchantName}
              onChange={(e) => setMerchantName(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("date")}</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("payment")}</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
              >
                <option value="">—</option>
                <option value="CASH">{t("payment_cash")}</option>
                <option value="CARD">{t("payment_card")}</option>
                <option value="UNKNOWN">{t("payment_transfer")}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("total_with_vat")}</label>
              <input
                type="text"
                value={totalWithVat}
                onChange={(e) => setTotalWithVat(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-700 mb-1">{t("total_without_vat")}</label>
              <input
                type="text"
                value={totalWithoutVat}
                onChange={(e) => setTotalWithoutVat(e.target.value)}
                className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">{t("linked_account")}</label>
            <select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
            >
              <option value="">{t("unassigned")}</option>
              {accounts.map((a) => (
                <option key={a.syncId} value={a.syncId}>{a.data.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1">{t("note")}</label>
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
            onClick={save}
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
