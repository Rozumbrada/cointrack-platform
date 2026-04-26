"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import {
  ParsedDocument,
  extractDocument,
  uploadFile,
} from "@/lib/gemini";
import { ensureCashAccount } from "@/lib/cash-account";
import { getDefaultAccountSyncId } from "@/lib/profile-store";
import { FormDialog, Field, inputClass } from "./FormDialog";

/**
 * Společný dialog pro skenování i nahrávání dokladu. AI sama rozezná,
 * jestli jde o účtenku nebo fakturu, a uloží do správné kolekce.
 *
 * mode="scan"   → otevře zadní kameru (capture="environment")
 * mode="upload" → klasický file picker
 */
export function DocumentDialog({
  mode,
  onClose,
}: {
  mode: "scan" | "upload";
  onClose: () => void;
}) {
  const router = useRouter();
  const { profileSyncId, entitiesByProfile } = useSyncData();
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Účty k výběru — bez Hotovost (CASH má vlastní auto-route)
  const nonCashAccounts = useMemo(
    () => accounts.filter((a) => !(a.data.type === "CASH" && a.data.excludedFromTotal)),
    [accounts],
  );

  /** Default účet pro non-cash doklady (z localStorage settings, fallback první). */
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  useEffect(() => {
    if (selectedAccountId) return;
    if (!profileSyncId) return;
    const saved = getDefaultAccountSyncId(profileSyncId);
    if (saved && nonCashAccounts.some((a) => a.syncId === saved)) {
      setSelectedAccountId(saved);
    } else if (nonCashAccounts.length > 0) {
      setSelectedAccountId(nonCashAccounts[0].syncId);
    }
  }, [profileSyncId, nonCashAccounts, selectedAccountId]);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParsedDocument | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  // Společná editovatelná pole
  const [docType, setDocType] = useState<"receipt" | "invoice">("receipt");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [totalWithVat, setTotalWithVat] = useState("");
  const [currency, setCurrency] = useState("CZK");
  const [paymentMethod, setPaymentMethod] = useState("CARD");
  const [note, setNote] = useState("");

  // Pouze pro fakturu
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [isExpense, setIsExpense] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [variableSymbol, setVariableSymbol] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Otevřít picker rovnou po mountu (lepší UX)
  useEffect(() => {
    fileInputRef.current?.click();
  }, []);

  async function onParse() {
    if (!file) return;
    setParsing(true);
    setErr(null);
    try {
      const purpose: "receipt" | "invoice" = "receipt"; // backend storage purpose — final klasifikace přijde z AI
      const [key, p] = await Promise.all([
        withAuth((t) => uploadFile(t, file, purpose)),
        withAuth((t) => extractDocument(t, file)),
      ]);
      setStorageKey(key);
      setParsed(p);
      setDocType(p.docType ?? "receipt");
      setMerchant(p.merchantName ?? p.supplierName ?? "");
      setDate(p.date ?? p.issueDate ?? new Date().toISOString().slice(0, 10));
      setTime(p.time ?? "");
      setTotalWithVat(p.totalWithVat?.toString() ?? "");
      setCurrency(p.currency ?? "CZK");
      setPaymentMethod(p.paymentMethod ?? "CARD");
      if (p.docType === "invoice") {
        setInvoiceNumber(p.invoiceNumber ?? "");
        setIsExpense(p.isExpense ?? true);
        setDueDate(p.dueDate ?? "");
        setVariableSymbol(p.variableSymbol ?? "");
      }
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
      const entitySyncId = crypto.randomUUID();
      const fileKeys = storageKey ? [storageKey] : [];

      // CASH → auto-Hotovost. Ostatní → uživatelem vybraný účet (s defaultem
      // z profile-store). Pokud non-cash + žádný účet vybraný (uživatel zatím
      // nemá žádný), zůstane undefined a tx se nevytvoří.
      const targetAccountSyncId =
        paymentMethod === "CASH"
          ? await ensureCashAccount(profileSyncId, currency)
          : (selectedAccountId || undefined);

      // Receipt = už proběhlá platba → vždy vytvořit matching tx
      // Invoice = může být nezaplacená → tx jen pro CASH (auto-paid)
      const receiptTxSyncId = targetAccountSyncId ? crypto.randomUUID() : undefined;
      const invoiceTxSyncId = paymentMethod === "CASH" && targetAccountSyncId
        ? crypto.randomUUID()
        : undefined;
      // Aliasy pro existující kód níž (zachování jmen z předchozí verze)
      const cashAccountSyncId = targetAccountSyncId;
      const cashTxSyncId = docType === "receipt" ? receiptTxSyncId : invoiceTxSyncId;

      if (docType === "receipt") {
        const data = {
          profileId: profileSyncId,
          merchantName: merchant.trim() || undefined,
          merchantIco: parsed?.merchantIco ?? undefined,
          merchantDic: parsed?.merchantDic ?? undefined,
          merchantStreet: parsed?.merchantStreet ?? undefined,
          merchantCity: parsed?.merchantCity ?? undefined,
          merchantZip: parsed?.merchantZip ?? undefined,
          date,
          time: time || undefined,
          totalWithVat: total.toFixed(2),
          totalWithoutVat: parsed?.totalWithoutVat?.toFixed(2),
          currency,
          paymentMethod,
          note,
          photoKeys: fileKeys,
          transactionId: cashTxSyncId,
        };
        const items = (parsed?.items ?? []).map((item, idx) => ({
          syncId: crypto.randomUUID(),
          updatedAt: now,
          clientVersion: 1,
          data: {
            receiptId: entitySyncId,
            name: item.name,
            quantity: item.quantity?.toString() ?? "1",
            totalPrice: (item.totalPrice ?? 0).toFixed(2),
            vatRate: item.vatRate ?? 21,
            position: idx,
          } as Record<string, unknown>,
        }));
        const cashTransactions = cashTxSyncId
          ? [
              {
                syncId: cashTxSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: {
                  profileId: profileSyncId,
                  accountId: cashAccountSyncId,
                  amount: (-Math.abs(total)).toFixed(2),
                  currency,
                  description: merchant.trim() || "Hotovostní platba",
                  merchant: merchant.trim() || undefined,
                  date,
                  isTransfer: false,
                } as Record<string, unknown>,
              },
            ]
          : [];
        await withAuth((t) =>
          sync.push(t, {
            entities: {
              receipts: [
                {
                  syncId: entitySyncId,
                  updatedAt: now,
                  clientVersion: 1,
                  data: data as unknown as Record<string, unknown>,
                },
              ],
              ...(items.length > 0 ? { receipt_items: items } : {}),
              ...(cashTransactions.length > 0
                ? { transactions: cashTransactions }
                : {}),
            },
          }),
        );
        router.push(`/app/receipts/${entitySyncId}`);
      } else {
        const data = {
          profileId: profileSyncId,
          invoiceNumber: invoiceNumber.trim() || undefined,
          isExpense,
          issueDate: date,
          dueDate: dueDate || undefined,
          totalWithVat: total.toFixed(2),
          totalWithoutVat: parsed?.totalWithoutVat?.toFixed(2),
          currency,
          supplierName: isExpense ? merchant.trim() || undefined : undefined,
          supplierIco: parsed?.supplierIco ?? undefined,
          supplierDic: parsed?.supplierDic ?? undefined,
          supplierStreet: parsed?.supplierStreet ?? undefined,
          supplierCity: parsed?.supplierCity ?? undefined,
          supplierZip: parsed?.supplierZip ?? undefined,
          customerName: !isExpense ? merchant.trim() || undefined : (parsed?.customerName ?? undefined),
          variableSymbol: variableSymbol.trim() || undefined,
          bankAccount: parsed?.bankAccount ?? undefined,
          paymentMethod,
          paid: paymentMethod === "CASH",
          fileKeys,
          linkedTransactionId: cashTxSyncId,
        };
        const items = (parsed?.items ?? []).map((item, idx) => ({
          syncId: crypto.randomUUID(),
          updatedAt: now,
          clientVersion: 1,
          data: {
            invoiceId: entitySyncId,
            name: item.name,
            quantity: item.quantity?.toString() ?? "1",
            totalPriceWithVat: (item.totalPrice ?? 0).toFixed(2),
            vatRate: item.vatRate ?? 21,
            position: idx,
          } as Record<string, unknown>,
        }));
        const cashTransactions = cashTxSyncId
          ? [
              {
                syncId: cashTxSyncId,
                updatedAt: now,
                clientVersion: 1,
                data: {
                  profileId: profileSyncId,
                  accountId: cashAccountSyncId,
                  amount: (isExpense ? -Math.abs(total) : Math.abs(total)).toFixed(2),
                  currency,
                  description:
                    (isExpense ? merchant : (parsed?.customerName ?? merchant))
                      .trim() || "Hotovostní platba",
                  merchant: merchant.trim() || undefined,
                  date,
                  isTransfer: false,
                } as Record<string, unknown>,
              },
            ]
          : [];
        await withAuth((t) =>
          sync.push(t, {
            entities: {
              invoices: [
                {
                  syncId: entitySyncId,
                  updatedAt: now,
                  clientVersion: 1,
                  data: data as unknown as Record<string, unknown>,
                },
              ],
              ...(items.length > 0 ? { invoice_items: items } : {}),
              ...(cashTransactions.length > 0
                ? { transactions: cashTransactions }
                : {}),
            },
          }),
        );
        router.push(`/app/invoices/${entitySyncId}`);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Fáze 1: před extrakcí — file picker (skrytý input + ručně otevřený)
  if (!parsed) {
    return (
      <FormDialog
        title={mode === "scan" ? "Skenovat doklad" : "Nahrát doklad"}
        onClose={onClose}
        onSave={onParse}
        saving={parsing}
        error={err}
        saveLabel="Načíst přes AI"
        saveDisabled={!file}
      >
        <p className="text-sm text-ink-600">
          {mode === "scan"
            ? "Vyfoť účtenku nebo fakturu zadní kamerou. AI sama rozezná typ dokladu a vyplní pole."
            : "Nahraj PDF nebo obrázek dokladu. AI sama rozezná, jestli je to účtenka nebo faktura."}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept={
            mode === "scan"
              ? "image/*"
              : "image/jpeg,image/png,image/webp,image/heic,application/pdf"
          }
          {...(mode === "scan" ? { capture: "environment" as const } : {})}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-6 rounded-xl border-2 border-dashed border-ink-300 hover:border-brand-500 hover:bg-brand-50 text-center text-sm font-medium text-ink-700 transition-colors"
        >
          {file ? (
            <>
              <div className="text-3xl mb-1">{mode === "scan" ? "📷" : "📄"}</div>
              <div className="text-ink-900 truncate">{file.name}</div>
              <div className="text-xs text-ink-500 mt-0.5">
                {(file.size / 1024 / 1024).toFixed(2)} MB · klikni pro výběr jiného
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl mb-1">{mode === "scan" ? "📷" : "📄"}</div>
              <div>{mode === "scan" ? "Vyfotit doklad" : "Vybrat soubor"}</div>
            </>
          )}
        </button>
        {parsing && (
          <div className="text-sm text-brand-600">
            ⏳ Nahrávám a posílám do AI…
          </div>
        )}
      </FormDialog>
    );
  }

  // Fáze 2: review extracted data
  return (
    <FormDialog
      title={
        docType === "receipt"
          ? "Zkontroluj data účtenky"
          : "Zkontroluj data faktury"
      }
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
      saveLabel={docType === "receipt" ? "Uložit účtenku" : "Uložit fakturu"}
    >
      {/* Type toggle — AI ji předvyplní, user může přepnout */}
      <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm">
        <button
          type="button"
          onClick={() => setDocType("receipt")}
          className={`flex-1 py-2 ${
            docType === "receipt" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700"
          }`}
        >
          🧾 Účtenka
        </button>
        <button
          type="button"
          onClick={() => setDocType("invoice")}
          className={`flex-1 py-2 ${
            docType === "invoice" ? "bg-brand-50 text-brand-700 font-medium" : "text-ink-700"
          }`}
        >
          📄 Faktura
        </button>
      </div>

      {docType === "invoice" && (
        <>
          <div className="flex rounded-lg border border-ink-300 overflow-hidden text-sm">
            <button
              type="button"
              onClick={() => setIsExpense(true)}
              className={`flex-1 py-2 ${
                isExpense ? "bg-red-50 text-red-700 font-medium" : "text-ink-700"
              }`}
            >
              Přijatá (výdaj)
            </button>
            <button
              type="button"
              onClick={() => setIsExpense(false)}
              className={`flex-1 py-2 ${
                !isExpense ? "bg-emerald-50 text-emerald-700 font-medium" : "text-ink-700"
              }`}
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
        </>
      )}

      <Field
        label={
          docType === "receipt"
            ? "Obchodník"
            : isExpense
              ? "Dodavatel"
              : "Odběratel"
        }
      >
        <input
          type="text"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={docType === "receipt" ? "Datum" : "Datum vystavení"}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        {docType === "receipt" ? (
          <Field label="Čas">
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={inputClass}
            />
          </Field>
        ) : (
          <Field label="Splatnost">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        )}
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
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={inputClass}
          >
            {["CZK", "EUR", "USD"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {docType === "invoice" ? (
        <Field label="Variabilní symbol">
          <input
            type="text"
            value={variableSymbol}
            onChange={(e) => setVariableSymbol(e.target.value)}
            className={inputClass}
          />
        </Field>
      ) : (
        <Field label="Způsob platby">
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className={inputClass}
          >
            <option value="CARD">Kartou</option>
            <option value="CASH">Hotově</option>
            <option value="UNKNOWN">Neznámo</option>
          </select>
        </Field>
      )}

      {/* Účet — CASH se automaticky zařadí na Hotovost (locked).
          Pro ostatní zdroje uživatel volí účet (default z profilu). */}
      {paymentMethod === "CASH" ? (
        <Field label="Účet">
          <div className="h-10 rounded-lg border border-ink-300 bg-ink-50 px-3 flex items-center text-sm text-ink-700">
            💵 Hotovost (automaticky)
          </div>
        </Field>
      ) : (
        <Field label="Účet">
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className={inputClass}
          >
            {nonCashAccounts.length === 0 && (
              <option value="">— žádný účet —</option>
            )}
            {nonCashAccounts.map((a) => (
              <option key={a.syncId} value={a.syncId}>
                {a.data.name} ({a.data.currency})
              </option>
            ))}
          </select>
        </Field>
      )}

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

      {docType === "receipt" && (
        <Field label="Poznámka">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className={`${inputClass} h-auto py-2`}
          />
        </Field>
      )}
    </FormDialog>
  );
}
