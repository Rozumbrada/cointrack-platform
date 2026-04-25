"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";

interface ReceiptData {
  merchantName: string;
  merchantIco?: string;
  merchantDic?: string;
  merchantStreet?: string;
  merchantCity?: string;
  merchantZip?: string;
  date: string;
  time?: string;
  totalWithVat: number;
  totalWithoutVat?: number;
  paymentMethod?: string;
  notes?: string;
  fileUris?: string;
  linkedTransactionId?: number;
  profileId?: string;
}

interface ReceiptItemData {
  receiptId: number;
  name: string;
  quantity?: number;
  unit?: string;
  unitPriceWithoutVat?: number;
  vatRate?: number;
  totalPriceWithVat: number;
}

export default function ReceiptDetailPage() {
  const router = useRouter();
  const params = useParams<{ syncId: string }>();
  const { loading, error, entitiesByProfile, rawEntities, reload } = useSyncData();

  const allReceipts = entitiesByProfile<ReceiptData>("receipts");
  const allItems = rawEntities("receipt_items");

  const receipt = useMemo(
    () => allReceipts.find((r) => r.syncId === params.syncId),
    [allReceipts, params.syncId],
  );

  // Items patří k receipt přes receiptId (Long), ale my máme syncId. Backend by měl
  // expose receiptSyncId, jinak musíme mapovat přes lokální Long ID. Pro web — server
  // posílá receiptId jako UUID, takže můžeme matchovat na syncId.
  const items = useMemo(() => {
    if (!receipt) return [];
    return allItems
      .filter((e) => {
        const d = e.data as Record<string, unknown>;
        return d.receiptId === params.syncId;
      })
      .map((e) => ({ syncId: e.syncId, data: e.data as unknown as ReceiptItemData }));
  }, [allItems, receipt, params.syncId]);

  async function onDelete() {
    if (!receipt) return;
    const ok = confirm(`Smazat účtenku "${receipt.data.merchantName ?? ""}"?`);
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

  if (loading) return <div className="py-20 text-center text-ink-500 text-sm">Načítám…</div>;
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
        Chyba: {error}
      </div>
    );
  if (!receipt) {
    return (
      <div className="space-y-4">
        <Link href="/app/receipts" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět
        </Link>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Účtenku <code>{params.syncId}</code> jsem nenašel — možná byla smazaná, nebo
          patří do jiného profilu.
        </div>
      </div>
    );
  }

  const r = receipt.data;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <Link href="/app/receipts" className="text-sm text-brand-600 hover:text-brand-700">
          ← Zpět na účtenky
        </Link>
        <button
          onClick={onDelete}
          className="text-sm text-red-600 hover:text-red-700"
        >
          🗑 Smazat
        </button>
      </div>

      <header className="bg-white rounded-2xl border border-ink-200 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">
              {r.merchantName || "(bez názvu)"}
            </h1>
            <p className="text-sm text-ink-600 mt-1">
              {r.date}
              {r.time && <span> · {r.time}</span>}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-500 uppercase tracking-wide">
              Celkem
            </div>
            <div className="text-2xl font-semibold text-ink-900 tabular-nums">
              {fmt(r.totalWithVat, "CZK")}
            </div>
          </div>
        </div>

        {(r.merchantIco || r.merchantDic || r.merchantStreet) && (
          <div className="mt-4 pt-4 border-t border-ink-100 grid grid-cols-2 gap-2 text-sm">
            {r.merchantIco && <Field label="IČO" value={r.merchantIco} />}
            {r.merchantDic && <Field label="DIČ" value={r.merchantDic} />}
            {r.merchantStreet && (
              <Field
                label="Adresa"
                value={[r.merchantStreet, r.merchantCity, r.merchantZip].filter(Boolean).join(", ")}
              />
            )}
            {r.paymentMethod && <Field label="Platba" value={labelPayment(r.paymentMethod)} />}
          </div>
        )}
      </header>

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
                    {i.data.quantity ?? 1}
                    {i.data.unit ? ` ${i.data.unit}` : ""}
                  </td>
                  <td className="px-6 py-3 text-ink-600 text-right tabular-nums">
                    {i.data.unitPriceWithoutVat != null
                      ? fmt(i.data.unitPriceWithoutVat, "CZK")
                      : "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-600 text-right tabular-nums">
                    {i.data.vatRate != null ? `${i.data.vatRate} %` : "—"}
                  </td>
                  <td className="px-6 py-3 text-ink-900 font-medium text-right tabular-nums">
                    {fmt(i.data.totalPriceWithVat, "CZK")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {r.notes && (
        <section className="bg-white rounded-2xl border border-ink-200 p-6">
          <h2 className="font-semibold text-ink-900 mb-2">Poznámka</h2>
          <p className="text-sm text-ink-700 whitespace-pre-wrap">{r.notes}</p>
        </section>
      )}

      {r.linkedTransactionId && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800">
          ✓ Účtenka je spárovaná s bankovní transakcí.
        </div>
      )}
    </div>
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

function fmt(amount: number, currency: string): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function labelPayment(p: string): string {
  switch (p) {
    case "CASH": return "Hotově";
    case "CARD": return "Kartou";
    default: return p;
  }
}
