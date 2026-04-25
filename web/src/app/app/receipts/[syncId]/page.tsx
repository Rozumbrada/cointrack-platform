"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { sync, api } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";

interface ReceiptData {
  profileId?: string;
  categoryId?: string;
  transactionId?: string;
  merchantName?: string;
  date: string;
  time?: string;
  totalWithVat: string | number;
  totalWithoutVat?: string | number;
  currency?: string;
  paymentMethod?: string;
  note?: string;
  photoKeys?: string[];
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
  const params = useParams<{ syncId: string }>();
  const { loading, error, entitiesByProfile, rawEntities } = useSyncData();

  const allReceipts = entitiesByProfile<ReceiptData>("receipts");
  const allItems = rawEntities("receipt_items");

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
          Účtenku <code>{params.syncId}</code> jsem nenašel.
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
          ← Zpět na účtenky
        </Link>
        <button onClick={onDelete} className="text-sm text-red-600 hover:text-red-700">
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
            {r.transactionId && (
              <p className="text-xs text-emerald-700 mt-1">
                ✓ Spárováno s bankovní transakcí
              </p>
            )}
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
          </div>
        </div>

        {r.paymentMethod && (
          <div className="mt-4 pt-4 border-t border-ink-100">
            <Field label="Platba" value={labelPayment(r.paymentMethod)} />
          </div>
        )}
      </header>

      {photoKeys.length > 0 && (
        <ReceiptPhotos keys={photoKeys} />
      )}

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
          <h2 className="font-semibold text-ink-900 mb-2">Poznámka</h2>
          <p className="text-sm text-ink-700 whitespace-pre-wrap">{r.note}</p>
        </section>
      )}
    </div>
  );
}

// ─── File preview přes presigned URL ──────────────────────────────────

function ReceiptPhotos({ keys }: { keys: string[] }) {
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
      <h2 className="font-semibold text-ink-900 mb-3">Foto účtenky</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {keys.map((k) => (
          <div key={k} className="aspect-[3/4] bg-ink-100 rounded-lg overflow-hidden">
            {urls[k] ? (
              <a href={urls[k]} target="_blank" rel="noopener">
                <img
                  src={urls[k]}
                  alt="účtenka"
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
                Načítám…
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

function labelPayment(p: string): string {
  switch (p) {
    case "CASH": return "Hotově";
    case "CARD": return "Kartou";
    default: return p;
  }
}
