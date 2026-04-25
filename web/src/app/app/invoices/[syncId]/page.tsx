"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { sync, api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";

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
  customerName?: string;
  note?: string;
  fileKeys?: string[];
  linkedTransactionId?: string;
  profileId?: string;
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
  const params = useParams<{ syncId: string }>();
  const { loading, error, entitiesByProfile, rawEntities } = useSyncData();

  const all = entitiesByProfile<InvoiceData>("invoices");
  const allItems = rawEntities("invoice_items");

  const invoice = useMemo(
    () => all.find((r) => r.syncId === params.syncId),
    [all, params.syncId],
  );

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

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;
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
          ← Zpět
        </Link>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Fakturu <code>{params.syncId}</code> jsem nenašel.
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
        <button onClick={onDelete} className="text-sm text-red-600 hover:text-red-700">
          🗑 Smazat
        </button>
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
              {r.issueDate && <span>Vystaveno: {r.issueDate}</span>}
              {r.dueDate && <span>Splatnost: {r.dueDate}</span>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-500 uppercase tracking-wide">Celkem</div>
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
              <div className="text-xs text-amber-700 mt-1">nezaplaceno</div>
            )}
          </div>
        </div>

        {(r.supplierIco || r.supplierDic || r.variableSymbol || r.bankAccount || r.paymentMethod) && (
          <div className="mt-4 pt-4 border-t border-ink-100 grid grid-cols-2 gap-2 text-sm">
            {r.supplierIco && <Field label="IČO dodavatele" value={r.supplierIco} />}
            {r.supplierDic && <Field label="DIČ dodavatele" value={r.supplierDic} />}
            {r.variableSymbol && <Field label="Variabilní symbol" value={r.variableSymbol} />}
            {r.bankAccount && <Field label="Bank. účet" value={r.bankAccount} />}
            {r.paymentMethod && <Field label="Platba" value={r.paymentMethod} />}
          </div>
        )}
      </header>

      {fileKeys.length > 0 && <InvoiceFiles keys={fileKeys} />}

      {items.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 overflow-hidden">
          <div className="px-6 py-3 border-b border-ink-200">
            <h2 className="font-semibold text-ink-900">Položky</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-ink-600 text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-6 py-3 font-medium">Název</th>
                <th className="px-6 py-3 font-medium text-right">Ks</th>
                <th className="px-6 py-3 font-medium text-right">Jedn. cena</th>
                <th className="px-6 py-3 font-medium text-right">DPH</th>
                <th className="px-6 py-3 font-medium text-right">Celkem</th>
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
          <h2 className="font-semibold text-ink-900 mb-2">Poznámka</h2>
          <p className="text-sm text-ink-700 whitespace-pre-wrap">{r.note}</p>
        </section>
      )}
    </div>
  );
}

function InvoiceFiles({ keys }: { keys: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map: Record<string, string> = {};
      for (const k of keys) {
        try {
          const res = await withAuth((t) =>
            api<{ url: string }>(
              `/api/v1/files/download-url?key=${encodeURIComponent(k)}`,
              { token: t },
            ),
          );
          map[k] = res.url;
        } catch {
          // skip
        }
      }
      if (!cancelled) setUrls(map);
    })();
    return () => { cancelled = true; };
  }, [keys]);

  return (
    <section className="bg-white rounded-2xl border border-ink-200 p-6">
      <h2 className="font-semibold text-ink-900 mb-3">Přílohy</h2>
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
                        <div className="text-xs text-brand-600 mt-1">Otevřít PDF</div>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={urls[k]}
                      alt="příloha"
                      className="w-full h-full object-contain hover:scale-105 transition-transform"
                    />
                  )}
                </a>
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
