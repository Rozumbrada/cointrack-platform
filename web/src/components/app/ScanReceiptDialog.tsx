"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { extractDocument, uploadFile } from "@/lib/gemini";
import { FormDialog, Field, inputClass } from "./FormDialog";

interface ParsedReceipt {
  merchantName?: string | null;
  date?: string | null;
  time?: string | null;
  totalWithVat?: number | null;
  totalWithoutVat?: number | null;
  currency?: string;
  paymentMethod?: string;
  items?: Array<{
    name: string;
    quantity?: number;
    totalPrice?: number;
    vatRate?: number;
  }>;
}

export function ScanReceiptDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { profileSyncId } = useSyncData();

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  // Editovatelná pole po parsing
  const [merchantName, setMerchantName] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [totalWithVat, setTotalWithVat] = useState("");
  const [currency, setCurrency] = useState("CZK");
  const [paymentMethod, setPaymentMethod] = useState("CARD");
  const [note, setNote] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onParse() {
    if (!file) return;
    setParsing(true);
    setErr(null);
    try {
      // Paralelně: upload + AI extrakce
      const [key, parsed] = await Promise.all([
        withAuth((t) => uploadFile(t, file, "receipt")),
        withAuth((t) => extractDocument<ParsedReceipt>(t, file, "receipt")),
      ]);
      setStorageKey(key);
      setParsed(parsed);
      setMerchantName(parsed.merchantName ?? "");
      setDate(parsed.date ?? new Date().toISOString().slice(0, 10));
      setTime(parsed.time ?? "");
      setTotalWithVat(parsed.totalWithVat?.toString() ?? "");
      setCurrency(parsed.currency ?? "CZK");
      setPaymentMethod(parsed.paymentMethod ?? "CARD");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (!profileSyncId) return setErr("Není vybraný profil.");
    const total = parseFloat(totalWithVat.replace(",", "."));
    if (!total || total <= 0) return setErr("Vyplň platnou celkovou částku.");

    setSaving(true);
    setErr(null);
    try {
      const now = new Date().toISOString();
      const receiptSyncId = crypto.randomUUID();
      const photoKeys = storageKey ? [storageKey] : [];

      // 1. Receipt
      const receiptData = {
        profileId: profileSyncId,
        merchantName: merchantName.trim() || undefined,
        date,
        time: time || undefined,
        totalWithVat: total.toFixed(2),
        totalWithoutVat: parsed?.totalWithoutVat?.toFixed(2),
        currency,
        paymentMethod,
        note,
        photoKeys,
      };

      // 2. Receipt items
      const items = (parsed?.items ?? []).map((item, idx) => ({
        syncId: crypto.randomUUID(),
        updatedAt: now,
        clientVersion: 1,
        data: {
          receiptId: receiptSyncId,
          name: item.name,
          quantity: item.quantity?.toString() ?? "1",
          totalPrice: (item.totalPrice ?? 0).toFixed(2),
          vatRate: item.vatRate ?? 21,
          position: idx,
        } as Record<string, unknown>,
      }));

      await withAuth((t) =>
        sync.push(t, {
          entities: {
            receipts: [
              {
                syncId: receiptSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: receiptData as unknown as Record<string, unknown>,
              },
            ],
            ...(items.length > 0 ? { receipt_items: items } : {}),
          },
        }),
      );
      router.push(`/app/receipts/${receiptSyncId}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Krok 1: file picker + parse button
  if (!parsed) {
    return (
      <FormDialog
        title="Naskenovat účtenku"
        onClose={onClose}
        onSave={onParse}
        saving={parsing}
        error={err}
        saveLabel="Načíst přes AI"
        saveDisabled={!file}
      >
        <p className="text-sm text-ink-600">
          Nahraj fotku účtenky. AI z ní automaticky vytáhne obchodníka, datum, položky a celkovou částku.
        </p>
        <Field label="Fotka účtenky">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
        </Field>
        {file && (
          <div className="text-xs text-ink-500">
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        )}
        {parsing && (
          <div className="text-sm text-brand-600">⏳ Nahrávám a posílám do AI…</div>
        )}
      </FormDialog>
    );
  }

  // Krok 2: review extracted data
  return (
    <FormDialog
      title="Zkontroluj data"
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
      saveLabel="Uložit účtenku"
    >
      <Field label="Obchodník">
        <input
          type="text"
          value={merchantName}
          onChange={(e) => setMerchantName(e.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Datum">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Čas">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Celkem s DPH">
            <input
              type="text"
              inputMode="decimal"
              value={totalWithVat}
              onChange={(e) => setTotalWithVat(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Měna">
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
            {["CZK", "EUR", "USD"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Způsob platby">
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
          <option value="CARD">Kartou</option>
          <option value="CASH">Hotově</option>
          <option value="UNKNOWN">Neznámo</option>
        </select>
      </Field>
      {parsed.items && parsed.items.length > 0 && (
        <div className="bg-ink-50 rounded-lg p-3 text-xs">
          <div className="font-medium text-ink-700 mb-1">
            Položky ({parsed.items.length})
          </div>
          <ul className="space-y-1 max-h-32 overflow-y-auto">
            {parsed.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate">{it.name}</span>
                <span className="tabular-nums shrink-0">
                  {(it.totalPrice ?? 0).toFixed(2)} {currency}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Field label="Poznámka">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className={`${inputClass} h-auto py-2`}
        />
      </Field>
    </FormDialog>
  );
}
