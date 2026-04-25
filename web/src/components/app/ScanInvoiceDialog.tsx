"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { extractDocument, uploadFile } from "@/lib/gemini";
import { FormDialog, Field, inputClass } from "./FormDialog";

interface ParsedInvoice {
  invoiceNumber?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  totalWithVat?: number | null;
  totalWithoutVat?: number | null;
  currency?: string;
  supplierName?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  customerName?: string | null;
  variableSymbol?: string | null;
  bankAccount?: string | null;
  paymentMethod?: string;
  isExpense?: boolean;
  items?: Array<{
    name: string;
    quantity?: number;
    totalPriceWithVat?: number;
    vatRate?: number;
  }>;
}

export function ScanInvoiceDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { profileSyncId } = useSyncData();

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [isExpense, setIsExpense] = useState(true);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [totalWithVat, setTotalWithVat] = useState("");
  const [currency, setCurrency] = useState("CZK");
  const [supplierName, setSupplierName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [variableSymbol, setVariableSymbol] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onParse() {
    if (!file) return;
    setParsing(true);
    setErr(null);
    try {
      const [key, parsed] = await Promise.all([
        withAuth((t) => uploadFile(t, file, "invoice")),
        withAuth((t) => extractDocument<ParsedInvoice>(t, file, "invoice")),
      ]);
      setStorageKey(key);
      setParsed(parsed);
      setInvoiceNumber(parsed.invoiceNumber ?? "");
      setIsExpense(parsed.isExpense ?? true);
      setIssueDate(parsed.issueDate ?? new Date().toISOString().slice(0, 10));
      setDueDate(parsed.dueDate ?? "");
      setTotalWithVat(parsed.totalWithVat?.toString() ?? "");
      setCurrency(parsed.currency ?? "CZK");
      setSupplierName(parsed.supplierName ?? "");
      setCustomerName(parsed.customerName ?? "");
      setVariableSymbol(parsed.variableSymbol ?? "");
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
      const invoiceSyncId = crypto.randomUUID();
      const fileKeys = storageKey ? [storageKey] : [];

      const invoiceData = {
        profileId: profileSyncId,
        invoiceNumber: invoiceNumber.trim() || undefined,
        isExpense,
        issueDate,
        dueDate: dueDate || undefined,
        totalWithVat: total.toFixed(2),
        totalWithoutVat: parsed?.totalWithoutVat?.toFixed(2),
        currency,
        supplierName: supplierName.trim() || undefined,
        supplierIco: parsed?.supplierIco ?? undefined,
        supplierDic: parsed?.supplierDic ?? undefined,
        customerName: customerName.trim() || undefined,
        variableSymbol: variableSymbol.trim() || undefined,
        bankAccount: parsed?.bankAccount ?? undefined,
        paymentMethod: parsed?.paymentMethod ?? "BANK_TRANSFER",
        paid: false,
        fileKeys,
      };

      const items = (parsed?.items ?? []).map((item, idx) => ({
        syncId: crypto.randomUUID(),
        updatedAt: now,
        clientVersion: 1,
        data: {
          invoiceId: invoiceSyncId,
          name: item.name,
          quantity: item.quantity?.toString() ?? "1",
          totalPriceWithVat: (item.totalPriceWithVat ?? 0).toFixed(2),
          vatRate: item.vatRate ?? 21,
          position: idx,
        } as Record<string, unknown>,
      }));

      await withAuth((t) =>
        sync.push(t, {
          entities: {
            invoices: [
              {
                syncId: invoiceSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: invoiceData as unknown as Record<string, unknown>,
              },
            ],
            ...(items.length > 0 ? { invoice_items: items } : {}),
          },
        }),
      );
      router.push(`/app/invoices/${invoiceSyncId}`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!parsed) {
    return (
      <FormDialog
        title="Nahrát fakturu"
        onClose={onClose}
        onSave={onParse}
        saving={parsing}
        error={err}
        saveLabel="Načíst přes AI"
        saveDisabled={!file}
      >
        <p className="text-sm text-ink-600">
          Nahraj PDF nebo fotku faktury. AI vyplní číslo, dodavatele, splatnost, VS a další detaily.
        </p>
        <Field label="Soubor faktury">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
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

  return (
    <FormDialog
      title="Zkontroluj data faktury"
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
      saveLabel="Uložit fakturu"
    >
      <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm">
        <button
          type="button"
          onClick={() => setIsExpense(true)}
          className={`flex-1 py-2 ${isExpense ? "bg-red-50 text-red-700 font-medium" : "text-ink-700"}`}
        >
          Přijatá (výdaj)
        </button>
        <button
          type="button"
          onClick={() => setIsExpense(false)}
          className={`flex-1 py-2 ${!isExpense ? "bg-emerald-50 text-emerald-700 font-medium" : "text-ink-700"}`}
        >
          Vystavená (příjem)
        </button>
      </div>
      <Field label="Číslo faktury">
        <input
          type="text"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Datum vystavení">
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Splatnost">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
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
      <Field label={isExpense ? "Dodavatel" : "Odběratel"}>
        <input
          type="text"
          value={isExpense ? supplierName : customerName}
          onChange={(e) =>
            isExpense ? setSupplierName(e.target.value) : setCustomerName(e.target.value)
          }
          className={inputClass}
        />
      </Field>
      <Field label="Variabilní symbol">
        <input
          type="text"
          value={variableSymbol}
          onChange={(e) => setVariableSymbol(e.target.value)}
          className={inputClass}
        />
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
                  {(it.totalPriceWithVat ?? 0).toFixed(2)} {currency}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormDialog>
  );
}
