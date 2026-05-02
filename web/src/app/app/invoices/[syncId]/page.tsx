"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { sync, api, idoklad } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-store";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import {
  InvoiceEditor,
  InvoiceData as InvoiceEditorData,
  InvoiceItemData as InvoiceEditorItemData,
} from "@/components/app/InvoiceEditor";

interface InvoiceData {
  invoiceNumber?: string;
  isExpense: boolean;
  issueDate?: string;
  dueDate?: string;
  totalWithVat: string | number;
  totalWithoutVat?: string | number;
  currency?: string;
  paymentMethod?: string;
  variableSymbol?: string;
  bankAccount?: string;
  paid?: boolean;
  supplierName?: string;
  supplierIco?: string;
  supplierDic?: string;
  supplierStreet?: string;
  supplierCity?: string;
  supplierZip?: string;
  customerName?: string;
  note?: string;
  fileKeys?: string[];
  linkedTransactionId?: string;
  linkedAccountId?: string;
  profileId?: string;
  idokladId?: string;
  source?: string;
  emailSubject?: string;
  emailSender?: string;
  emailReceivedAt?: string;
}

interface InvoiceItemData {
  invoiceId: string;
  name: string;
  quantity?: string | number;
  unitPriceWithVat?: string | number;
  totalPriceWithVat: string | number;
  vatRate?: string | number;
  position?: number;
}

export default function InvoiceDetailPage() {
  const router = useRouter();
  const t = useTranslations("invoice_detail");
  const params = useParams<{ syncId: string }>();
  const { loading, error, entitiesByProfile, rawEntities, profileSyncId, reload } = useSyncData();

  const all = entitiesByProfile<InvoiceData>("invoices");
  const allItems = rawEntities("invoice_items");
  // Transakce profile-scope, abychom mohli zobrazit detail spárované platby.
  const allTransactions = entitiesByProfile<{
    amount: string | number;
    currency?: string;
    date?: string;
    description?: string;
    merchant?: string;
    accountId?: string;
  }>("transactions");
  const allAccounts = entitiesByProfile<{ name: string; type?: string; currency?: string }>("accounts");
  const [editing, setEditing] = useState(false);
  // POZOR: všechny useState/useMemo/useEffect MUSÍ být před early returny níž.
  // Předtím byl showPayDialog deklarovaný až za `if (loading)` / `if (!invoice)`,
  // což porušilo Rules of Hooks → React házel "Rendered more hooks than during
  // the previous render" → detail faktury se nedalo vůbec otevřít (page crash).
  const [showPayDialog, setShowPayDialog] = useState(false);

  const invoice = useMemo(
    () => all.find((r) => r.syncId === params.syncId),
    [all, params.syncId],
  );

  const linkedTx = useMemo(() => {
    const txId = invoice?.data.linkedTransactionId;
    if (!txId) return null;
    return allTransactions.find((t) => t.syncId === txId) ?? null;
  }, [invoice, allTransactions]);

  const linkedTxAccount = useMemo(() => {
    if (!linkedTx) return null;
    const accId = linkedTx.data.accountId;
    if (!accId) return null;
    return allAccounts.find((a) => a.syncId === accId) ?? null;
  }, [linkedTx, allAccounts]);

  const items = useMemo(() => {
    if (!invoice) return [];
    return allItems
      .filter((e) => {
        const d = e.data as Record<string, unknown>;
        return d.invoiceId === invoice.syncId;
      })
      .map((e) => ({ syncId: e.syncId, data: e.data as unknown as InvoiceItemData }))
      .sort((a, b) => (a.data.position ?? 0) - (b.data.position ?? 0));
  }, [allItems, invoice]);

  async function onDelete() {
    if (!invoice) return;
    const ok = confirm(`Smazat fakturu ${invoice.data.invoiceNumber ?? ""}?`);
    if (!ok) return;
    try {
      const now = new Date().toISOString();
      await withAuth((t) =>
        sync.push(t, {
          entities: {
            invoices: [
              {
                syncId: invoice.syncId,
                updatedAt: now,
                deletedAt: now,
                clientVersion: 1,
                data: invoice.data as unknown as Record<string, unknown>,
              },
            ],
          },
        }),
      );
      router.push("/app/invoices");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">{t("loading")}</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        Chyba: {error}
      </div>
    );
  if (!invoice) {
    return (
      <div className="space-y-4">
        <Link href="/app/invoices" className="text-sm text-brand-600 hover:text-brand-700">
          {t("back")}
        </Link>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          {t.rich("not_found", { id: () => <code>{params.syncId}</code> })}
        </div>
      </div>
    );
  }

  const r = invoice.data;
  const partner = r.isExpense ? r.supplierName : r.customerName;
  const currency = r.currency || "CZK";
  const fileKeys = Array.isArray(r.fileKeys) ? r.fileKeys : [];
  const isPaid = r.paid || !!r.linkedTransactionId;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <Link href="/app/invoices" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět na faktury
        </Link>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            ✏️ Upravit
          </button>
          <button onClick={onDelete} className="text-sm text-red-600 hover:text-red-700">
            🗑 Smazat
          </button>
        </div>
      </div>

      <header className="bg-white rounded-2xl border border-ink-200 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold text-ink-900">
                {r.invoiceNumber || "(bez čísla)"}
              </h1>
              <span
                className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                  r.isExpense
                    ? "bg-red-100 text-red-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {r.isExpense ? "přijatá" : "vystavená"}
              </span>
            </div>
            <p className="text-sm text-ink-600">{partner ?? "—"}</p>
            <div className="text-xs text-ink-500 mt-1 flex gap-3">
              {r.issueDate && <span>{t("issued_label")} {r.issueDate}</span>}
              {r.dueDate && <span>{t("due_label")} {r.dueDate}</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-500 uppercase tracking-wide">{t("total")}</div>
            <div className="text-2xl font-semibold text-ink-900 tabular-nums">
              {fmtAmt(r.totalWithVat, currency)}
            </div>
            {r.totalWithoutVat && (
              <div className="text-xs text-ink-500 mt-1">
                bez DPH: {fmtAmt(r.totalWithoutVat, currency)}
              </div>
            )}
            {isPaid ? (
              <div className="text-xs text-emerald-700 mt-1">✓ uhrazeno</div>
            ) : (
              <div className="mt-1 space-y-1">
                <div className="text-xs text-amber-700">nezaplaceno</div>
                <button
                  type="button"
                  onClick={() => setShowPayDialog(true)}
                  className="text-xs h-7 px-3 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                >
                  💰 Zaplatit
                </button>
              </div>
            )}
            {r.source === "email" && (
              <div className="mt-2 text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded inline-block">
                📧 Z emailu
              </div>
            )}
          </div>
        </div>

        {(r.supplierIco || r.supplierDic || r.supplierStreet || r.supplierCity ||
          r.variableSymbol || r.bankAccount || r.paymentMethod) && (
          <div className="mt-4 pt-4 border-t border-ink-100 grid grid-cols-2 gap-2 text-sm">
            {r.supplierIco && <Field label={t("supplier_ico")} value={r.supplierIco} />}
            {r.supplierDic && <Field label={t("supplier_dic")} value={r.supplierDic} />}
            {r.supplierStreet && <Field label={t("supplier_street")} value={r.supplierStreet} />}
            {(r.supplierCity || r.supplierZip) && (
              <Field
                label={t("supplier_city")}
                value={[r.supplierZip, r.supplierCity].filter(Boolean).join(" ")}
              />
            )}
            {r.variableSymbol && <Field label={t("vs_label")} value={r.variableSymbol} />}
            {r.bankAccount && <Field label={t("bank_account")} value={r.bankAccount} />}
            {r.paymentMethod && <Field label={t("payment")} value={r.paymentMethod} />}
          </div>
        )}
      </header>

      {r.idokladId && (
        <IDokladActions
          profileSyncId={profileSyncId ?? ""}
          idokladId={r.idokladId}
          isPaid={isPaid}
          customerEmail={r.customerName ? null : null}
          onDone={reload}
        />
      )}

      {/* Spárovaná platba — zobrazí klikatelný odkaz na transakci, která fakturu uhradila. */}
      {linkedTx && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-emerald-700">✓</span>
                <h2 className="font-semibold text-emerald-900">Spárováno s platbou</h2>
              </div>
              <div className="text-sm text-emerald-800">
                {linkedTx.data.description || linkedTx.data.merchant || "Bankovní transakce"}
              </div>
              <div className="text-xs text-emerald-700 mt-1 flex flex-wrap gap-3">
                {linkedTx.data.date && <span>{linkedTx.data.date}</span>}
                {linkedTxAccount && <span>· účet: {linkedTxAccount.data.name}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-lg font-semibold text-emerald-900 tabular-nums">
                {fmtAmt(linkedTx.data.amount, linkedTx.data.currency || "CZK")}
              </div>
              <Link
                href={`/app/transactions/${linkedTx.syncId}`}
                className="text-xs text-emerald-700 hover:text-emerald-900 underline mt-1 inline-block"
              >
                Otevřít transakci →
              </Link>
            </div>
          </div>
        </section>
      )}

      {fileKeys.length > 0 && <InvoiceFiles keys={fileKeys} />}

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
                    {i.data.unitPriceWithVat != null
                      ? fmtAmt(i.data.unitPriceWithVat, currency)
                      : "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-600 text-right tabular-nums">
                    {i.data.vatRate != null ? `${fmtNum(i.data.vatRate)} %` : "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-900 font-medium text-right tabular-nums">
                    {fmtAmt(i.data.totalPriceWithVat, currency)}
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

      {editing && invoice && (
        <InvoiceEditor
          initial={{
            syncId: invoice.syncId,
            data: {
              ...invoice.data,
              totalWithVat: String(invoice.data.totalWithVat),
              totalWithoutVat:
                invoice.data.totalWithoutVat != null
                  ? String(invoice.data.totalWithoutVat)
                  : undefined,
              currency: invoice.data.currency || "CZK",
              paid: !!invoice.data.paid,
              fileKeys: Array.isArray(invoice.data.fileKeys)
                ? invoice.data.fileKeys
                : [],
              profileId: invoice.data.profileId ?? "",
            } as InvoiceEditorData,
          }}
          initialItems={items.map((it) => ({
            syncId: it.syncId,
            data: {
              invoiceId: it.data.invoiceId,
              name: it.data.name,
              quantity: String(it.data.quantity ?? "1"),
              unitPriceWithVat:
                it.data.unitPriceWithVat != null
                  ? String(it.data.unitPriceWithVat)
                  : undefined,
              totalPriceWithVat: String(it.data.totalPriceWithVat ?? "0"),
              vatRate: it.data.vatRate != null ? String(it.data.vatRate) : undefined,
              position: it.data.position ?? 0,
            } as InvoiceEditorItemData,
          }))}
          rawItemEntities={allItems}
          profileSyncId={profileSyncId}
          accounts={entitiesByProfile<{ name: string; type?: string }>("accounts")}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await reload();
          }}
        />
      )}

      {showPayDialog && (
        <PayInvoiceDialog
          invoiceSyncId={params.syncId}
          invoice={r}
          profileSyncId={profileSyncId}
          accounts={entitiesByProfile<{ name: string; type?: string; currency?: string }>("accounts")}
          onClose={() => setShowPayDialog(false)}
          onPaid={async () => {
            setShowPayDialog(false);
            await reload();
          }}
        />
      )}
    </div>
  );
}

// ─── Pay Invoice Dialog ─────────────────────────────────────────────

function PayInvoiceDialog({
  invoiceSyncId,
  invoice,
  profileSyncId,
  accounts,
  onClose,
  onPaid,
}: {
  invoiceSyncId: string;
  invoice: InvoiceData;
  profileSyncId: string | null;
  accounts: Array<{ syncId: string; data: { name: string; type?: string; currency?: string } }>;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [accountSyncId, setAccountSyncId] = useState<string>(accounts[0]?.syncId ?? "");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit() {
    if (!profileSyncId || !accountSyncId) return;
    const total = parseFloat(String(invoice.totalWithVat).replace(",", ".")) || 0;
    if (total <= 0) {
      setErr("Faktura má neplatnou částku.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const txSyncId = crypto.randomUUID();
      // EXPENSE pro přijatou (peníze odejdou), INCOME pro vystavenou (peníze přijdou)
      const amount = invoice.isExpense ? -Math.abs(total) : Math.abs(total);
      const description = invoice.isExpense
        ? (invoice.supplierName || invoice.invoiceNumber || "Faktura")
        : (invoice.customerName || invoice.invoiceNumber || "Faktura");
      await withAuth((tk) =>
        sync.push(tk, {
          entities: {
            transactions: [
              {
                syncId: txSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: {
                  profileId: profileSyncId,
                  accountId: accountSyncId,
                  amount: amount.toFixed(2),
                  currency: invoice.currency || "CZK",
                  description,
                  date,
                  note: note.trim() || undefined,
                  isTransfer: false,
                },
              },
            ],
            invoices: [
              {
                syncId: invoiceSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: {
                  ...(invoice as unknown as Record<string, unknown>),
                  paid: true,
                  linkedTransactionId: txSyncId,
                  linkedAccountId: accountSyncId,
                },
              },
            ],
          },
        }),
      );
      await onPaid();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const total = parseFloat(String(invoice.totalWithVat).replace(",", ".")) || 0;
  const currency = invoice.currency || "CZK";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-ink-200 max-w-md w-full p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Zaplatit fakturu</h2>
          <p className="text-sm text-ink-600 mt-1">
            {invoice.isExpense ? "Z účtu odejde" : "Na účet přijde"}{" "}
            <strong className="tabular-nums">{total.toLocaleString("cs-CZ", { style: "currency", currency })}</strong>
            {invoice.invoiceNumber && <span className="text-ink-500"> · {invoice.invoiceNumber}</span>}
          </p>
        </div>

        <label className="block">
          <div className="text-xs font-medium text-ink-700 mb-1">Účet</div>
          <select
            value={accountSyncId}
            onChange={(e) => setAccountSyncId(e.target.value)}
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
          >
            {accounts.length === 0 && <option value="">— žádný účet —</option>}
            {accounts.map((a) => (
              <option key={a.syncId} value={a.syncId}>
                {a.data.name} ({a.data.currency ?? "CZK"})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <div className="text-xs font-medium text-ink-700 mb-1">Datum platby</div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
          />
        </label>

        <label className="block">
          <div className="text-xs font-medium text-ink-700 mb-1">Poznámka (volitelné)</div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Např. variabilní symbol, kdo platil…"
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
          />
        </label>

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">{err}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-10 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
          >
            Zrušit
          </button>
          <button
            onClick={onSubmit}
            disabled={saving || !accountSyncId}
            className="flex-1 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {saving ? "Ukládám…" : "💰 Zaplatit"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InvoiceFiles({ keys }: { keys: string[] }) {
  const t = useTranslations("invoice_detail");
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
      <h2 className="font-semibold text-ink-900 mb-3">{t("files")}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {keys.map((k) => {
          const isPdf = k.toLowerCase().endsWith(".pdf");
          return (
            <div key={k} className="aspect-[3/4] bg-ink-100 rounded-lg overflow-hidden">
              {urls[k] ? (
                <a href={urls[k]} target="_blank" rel="noopener" className="block w-full h-full">
                  {isPdf ? (
                    <div className="w-full h-full grid place-items-center text-center p-4">
                      <div>
                        <div className="text-4xl mb-2">📄</div>
                        <div className="text-xs text-ink-700 break-all">{k.split("/").pop()}</div>
                        <div className="text-xs text-brand-600 mt-1">{t("open_pdf")}</div>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={urls[k]}
                      alt={t("attachment_alt")}
                      className="w-full h-full object-contain hover:scale-105 transition-transform"
                    />
                  )}
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
                  Načítám…
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500">{label}</div>
      <div className="text-ink-900">{value}</div>
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

function IDokladActions({
  profileSyncId,
  idokladId,
  isPaid,
  customerEmail: _customerEmail,
  onDone,
}: {
  profileSyncId: string;
  idokladId: string;
  isPaid: boolean;
  customerEmail: string | null;
  onDone: () => void | Promise<void>;
}) {
  const t = useTranslations("invoice_detail");
  const [busy, setBusy] = useState<null | "pdf" | "paid" | "email">(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function downloadPdf() {
    setBusy("pdf"); setMsg(null); setErr(null);
    const token = getAccessToken();
    if (!token) return;
    try {
      const res = await fetch(idoklad.pdfUrl(profileSyncId, idokladId), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `faktura-${idokladId}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(`PDF se nepodařilo stáhnout: ${e}`);
    } finally {
      setBusy(null);
    }
  }

  async function markPaid() {
    if (!confirm(t("idoklad_mark_paid_confirm"))) return;
    setBusy("paid"); setMsg(null); setErr(null);
    const token = getAccessToken();
    if (!token) return;
    try {
      await idoklad.markPaid(token, profileSyncId, idokladId);
      setMsg(t("idoklad_marked_paid"));
      await onDone();
    } catch (e) {
      setErr(`Mark-paid selhal: ${e}`);
    } finally {
      setBusy(null);
    }
  }

  async function sendEmail() {
    const recipient = prompt(t("idoklad_email_prompt"));
    if (recipient === null) return;
    setBusy("email"); setMsg(null); setErr(null);
    const token = getAccessToken();
    if (!token) return;
    try {
      await idoklad.sendEmail(token, profileSyncId, idokladId, recipient || undefined);
      setMsg(t("idoklad_email_sent"));
    } catch (e) {
      setErr(`Email selhal: ${e}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide bg-blue-200 text-blue-900 px-2 py-0.5 rounded">
          iDoklad
        </span>
        <span className="text-xs text-blue-900">
          ID: <code>{idokladId}</code>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={downloadPdf}
          disabled={busy !== null}
          className="h-9 px-3 rounded-lg bg-white border border-ink-300 hover:bg-ink-50 disabled:opacity-50 text-sm font-medium text-ink-900"
        >
          {busy === "pdf" ? t("downloading") : t("download_pdf")}
        </button>
        {!isPaid && (
          <button
            onClick={markPaid}
            disabled={busy !== null}
            className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {busy === "paid" ? "…" : t("mark_paid")}
          </button>
        )}
        <button
          onClick={sendEmail}
          disabled={busy !== null}
          className="h-9 px-3 rounded-lg bg-white border border-ink-300 hover:bg-ink-50 disabled:opacity-50 text-sm font-medium text-ink-900"
        >
          {busy === "email" ? t("sending") : t("send_to_customer")}
        </button>
      </div>
      {msg && <div className="text-sm text-emerald-700">{msg}</div>}
      {err && <div className="text-sm text-red-700">{err}</div>}
    </section>
  );
}
