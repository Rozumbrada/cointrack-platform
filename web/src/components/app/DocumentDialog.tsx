"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { enqueueFile, deleteRecord } from "@/lib/scan-queue";
import { isTransientError } from "@/lib/scan-queue-hook";
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
  /**
   * Volitelný pre-extrakt: pokud dialog otevíráme z queue (READY položka),
   * dostaneme parsed data + storageKey hned, a přeskočíme file picker → AI
   * krok. Po save smažeme záznam ve frontě (queueRecordId).
   */
  preExtracted,
}: {
  mode: "scan" | "upload";
  onClose: () => void;
  preExtracted?: {
    parsed: ParsedDocument;
    storageKey?: string;
    queueRecordId: string;
  };
}) {
  const router = useRouter();
  const t = useTranslations("document_dialog");
  const tInvEditor = useTranslations("invoice_editor");
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
  const [parsed, setParsed] = useState<ParsedDocument | null>(preExtracted?.parsed ?? null);
  const [storageKey, setStorageKey] = useState<string | null>(preExtracted?.storageKey ?? null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);

  // Společná editovatelná pole
  const [docType, setDocType] = useState<"receipt" | "invoice">("receipt");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("");
  const [totalWithVat, setTotalWithVat] = useState("");
  const [currency, setCurrency] = useState("CZK");
  const [paymentMethod, setPaymentMethod] = useState("CARD");
  const [note, setNote] = useState("");

  // IČO/DIČ + adresa — partner identity (pro export do Pohody i pro detail).
  // Nově editovatelné v review screenu, předtím se jen "tiše" uložily ze parsed.
  const [ico, setIco] = useState("");
  const [dic, setDic] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  /**
   * Provozovna — pobočka obchodu z účtenky. Posílá se jen na server (Pohoda
   * XML export ji nepoužívá). Pro faktury (docType=invoice) zůstává prázdné.
   */
  const [provozovna, setProvozovna] = useState("");

  // Pouze pro fakturu
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [isExpense, setIsExpense] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [variableSymbol, setVariableSymbol] = useState("");
  const [bankAccount, setBankAccount] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ARES lookup state — auto po OCR (pokud IČO má 8 číslic) + manuální tlačítko.
  // Vyplní/přepíše název, DIČ, ulici, město, PSČ podle veřejného registru.
  const [aresLoading, setAresLoading] = useState(false);
  const [aresError, setAresError] = useState<string | null>(null);
  const [aresInfo, setAresInfo] = useState<string | null>(null);
  const aresLookedUpFor = useRef<string | null>(null);

  /**
   * Provede ARES lookup pro daný IČO. Default `auto=false` znamená manuální
   * klik (vždy přepíše název). `auto=true` (po OCR) má jemnější chování:
   * vyplní jen ta pole co AI nezachytila, název přepíše vždy (ARES je
   * autoritativní zdroj firemního názvu).
   */
  async function lookupAres(auto = false) {
    const cleanIco = ico.replace(/\D/g, "");
    if (cleanIco.length < 6) {
      if (!auto) setAresError("Zadej IČO (min. 6 číslic).");
      return;
    }
    setAresError(null);
    setAresInfo(null);
    setAresLoading(true);
    try {
      const res = await fetch(
        `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(cleanIco)}`,
      );
      if (!res.ok) {
        if (res.status === 404 && !auto)
          setAresError("Subjekt s tímto IČO nebyl v ARES nalezen.");
        else if (!auto)
          setAresError(`ARES nedostupný (${res.status}).`);
        return;
      }
      const data = (await res.json()) as {
        obchodniJmeno?: string;
        dic?: string;
        sidlo?: {
          uliceSCislem?: string;
          textovaAdresa?: string;
          nazevObce?: string;
          psc?: number;
        };
      };
      // Název: vždy přepíše (ARES je autoritativní + AI to často přečte
      // s překlepy z účtenkového tisku).
      if (data.obchodniJmeno) setMerchant(data.obchodniJmeno);
      if (data.dic && !dic.trim()) setDic(data.dic);
      const sidlo = data.sidlo;
      if (sidlo) {
        const street = sidlo.uliceSCislem ?? sidlo.textovaAdresa;
        if (street) setStreet(street);
        if (sidlo.nazevObce) setCity(sidlo.nazevObce);
        if (sidlo.psc != null) setZip(String(sidlo.psc));
      }
      if (auto) setAresInfo("✓ Údaje doplněny z ARES");
    } catch (e) {
      if (!auto) setAresError(e instanceof Error ? e.message : String(e));
    } finally {
      setAresLoading(false);
    }
  }

  // Auto-ARES po OCR — když parser vrátí 8místné IČO, automaticky doplní
  // partner data (název, DIČ, adresa). Ref `aresLookedUpFor` brání
  // opakovanému volání pro stejné IČO (např. když user opraví město a
  // useEffect by jinak znovu spustil ARES).
  useEffect(() => {
    if (!parsed) return;
    const cleanIco = ico.replace(/\D/g, "");
    if (cleanIco.length !== 8) return;
    if (aresLookedUpFor.current === cleanIco) return;
    aresLookedUpFor.current = cleanIco;
    lookupAres(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, ico]);

  // Otevřít picker rovnou po mountu (lepší UX) — JEN pokud nemáme pre-extract
  useEffect(() => {
    if (preExtracted) return;
    fileInputRef.current?.click();
  }, [preExtracted]);

  // Když máme pre-extract (z queue), předvyplň všechna pole z parsed dat hned
  useEffect(() => {
    if (!preExtracted) return;
    const p = preExtracted.parsed;
    const detected = p.docType ?? "receipt";
    setDocType(detected);
    setDate(p.date ?? p.issueDate ?? new Date().toISOString().slice(0, 10));
    setTime(p.time ?? "");
    setTotalWithVat(p.totalWithVat?.toString() ?? "");
    setCurrency(p.currency ?? "CZK");
    setPaymentMethod(p.paymentMethod ?? "CARD");
    const isExp = p.isExpense ?? true;
    if (detected === "receipt") {
      setMerchant(p.merchantName ?? "");
      setIco(p.merchantIco ?? "");
      setDic(p.merchantDic ?? "");
      setStreet(p.merchantStreet ?? "");
      setCity(p.merchantCity ?? "");
      setZip(p.merchantZip ?? "");
      setProvozovna(p.provozovna ?? "");
    } else if (isExp) {
      setMerchant(p.supplierName ?? "");
      setIco(p.supplierIco ?? "");
      setDic(p.supplierDic ?? "");
      setStreet(p.supplierStreet ?? "");
      setCity(p.supplierCity ?? "");
      setZip(p.supplierZip ?? "");
    } else {
      setMerchant(p.customerName ?? "");
      setIco(p.customerIco ?? "");
      setDic(p.customerDic ?? "");
      setStreet(p.customerStreet ?? "");
      setCity(p.customerCity ?? "");
      setZip(p.customerZip ?? "");
    }
    if (detected === "invoice") {
      setInvoiceNumber(p.invoiceNumber ?? "");
      setIsExpense(isExp);
      setDueDate(p.dueDate ?? "");
      setVariableSymbol(p.variableSymbol ?? "");
      const ba = p.bankAccount ?? "";
      const bc = p.bankCode ?? "";
      setBankAccount(ba && bc && !ba.includes("/") ? `${ba}/${bc}` : ba);
    }
  }, [preExtracted]);

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
      const detected = p.docType ?? "receipt";
      setDocType(detected);
      setDate(p.date ?? p.issueDate ?? new Date().toISOString().slice(0, 10));
      setTime(p.time ?? "");
      setTotalWithVat(p.totalWithVat?.toString() ?? "");
      setCurrency(p.currency ?? "CZK");
      setPaymentMethod(p.paymentMethod ?? "CARD");

      // Partner identity: pro receipt → merchant*, pro invoice → supplier* nebo customer*
      // (podle isExpense). Default isExpense=true (přijatá faktura — na nás).
      const isExp = p.isExpense ?? true;
      if (detected === "receipt") {
        setMerchant(p.merchantName ?? "");
        setIco(p.merchantIco ?? "");
        setDic(p.merchantDic ?? "");
        setStreet(p.merchantStreet ?? "");
        setCity(p.merchantCity ?? "");
        setZip(p.merchantZip ?? "");
        setProvozovna(p.provozovna ?? "");
      } else if (isExp) {
        // Přijatá: merchant = supplier
        setMerchant(p.supplierName ?? "");
        setIco(p.supplierIco ?? "");
        setDic(p.supplierDic ?? "");
        setStreet(p.supplierStreet ?? "");
        setCity(p.supplierCity ?? "");
        setZip(p.supplierZip ?? "");
      } else {
        // Vystavená: merchant = customer
        setMerchant(p.customerName ?? "");
        setIco(p.customerIco ?? "");
        setDic(p.customerDic ?? "");
        setStreet(p.customerStreet ?? "");
        setCity(p.customerCity ?? "");
        setZip(p.customerZip ?? "");
      }

      if (detected === "invoice") {
        setInvoiceNumber(p.invoiceNumber ?? "");
        setIsExpense(isExp);
        setDueDate(p.dueDate ?? "");
        setVariableSymbol(p.variableSymbol ?? "");
        // Bank account — sjednoť IBAN i číslo/kód do jednoho fieldu (zachová mobile naming).
        const ba = p.bankAccount ?? "";
        const bc = p.bankCode ?? "";
        setBankAccount(ba && bc && !ba.includes("/") ? `${ba}/${bc}` : ba);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Pokud je chyba transient (síť, 5xx, 429), uložíme soubor do scan-fronty
      // a zavřeme dialog. User uvidí queue card na home a zpracuje to později.
      if (file && profileSyncId && isTransientError(msg)) {
        try {
          await enqueueFile({ profileSyncId, file, initialError: msg });
          setQueuedNotice(
            "AI zrovna neodpovídá. Doklad jsme uložili do fronty — zpracujeme ho hned, jak to půjde.",
          );
          // Krátká prodleva, ať user uvidí hlášku, pak zavři
          setTimeout(() => onClose(), 1500);
        } catch (enqErr) {
          setErr(`${msg} · Selhalo i uložení do fronty: ${enqErr instanceof Error ? enqErr.message : String(enqErr)}`);
        }
      } else {
        setErr(msg);
      }
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (!profileSyncId) return setErr(t("no_profile"));
    const total = parseFloat(totalWithVat.replace(",", "."));
    if (!total || total <= 0) return setErr(t("fill_amount"));

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

      // null místo undefined → explicit clear na serveru. Důvod viz fix(sync) commit
      // (server používá containsKey guard proti clobberu, undefined by JSON vyhodil
       // a hodnotu by NEsmazal — což je špatně, když uživatel pole vyprázdnil).
      const orNull = (v: string) => (v.trim().length > 0 ? v.trim() : null);
      if (docType === "receipt") {
        const data = {
          profileId: profileSyncId,
          merchantName: orNull(merchant),
          // Partner identity z editovatelných polí (user mohl AI hodnoty upravit)
          merchantIco: orNull(ico),
          merchantDic: orNull(dic),
          merchantStreet: orNull(street),
          merchantCity: orNull(city),
          merchantZip: orNull(zip),
          // Provozovna — server-side pole (Pohoda XML ji ignoruje)
          provozovna: orNull(provozovna),
          date,
          time: time || null,
          totalWithVat: total.toFixed(2),
          totalWithoutVat: parsed?.totalWithoutVat?.toFixed(2) ?? null,
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
                  description: merchant.trim() || t("cash_payment_default"),
                  merchant: orNull(merchant),
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
        // Partner identity — `merchant`+`ico`+atd. v UI patří dle isExpense buď
        // dodavateli (přijatá) nebo odběrateli (vystavená). Druhý partner se
        // bere z parsed (pokud Gemini zachytil obě strany).
        const data = {
          profileId: profileSyncId,
          invoiceNumber: orNull(invoiceNumber),
          isExpense,
          issueDate: date,
          dueDate: dueDate || null,
          totalWithVat: total.toFixed(2),
          totalWithoutVat: parsed?.totalWithoutVat?.toFixed(2) ?? null,
          currency,
          // Supplier (dodavatel)
          supplierName: isExpense ? orNull(merchant) : (parsed?.supplierName ?? null),
          supplierIco: isExpense ? orNull(ico) : (parsed?.supplierIco ?? null),
          supplierDic: isExpense ? orNull(dic) : (parsed?.supplierDic ?? null),
          supplierStreet: isExpense ? orNull(street) : (parsed?.supplierStreet ?? null),
          supplierCity: isExpense ? orNull(city) : (parsed?.supplierCity ?? null),
          supplierZip: isExpense ? orNull(zip) : (parsed?.supplierZip ?? null),
          // Customer (odběratel)
          customerName: !isExpense ? orNull(merchant) : (parsed?.customerName ?? null),
          customerIco: !isExpense ? orNull(ico) : (parsed?.customerIco ?? null),
          customerDic: !isExpense ? orNull(dic) : (parsed?.customerDic ?? null),
          customerStreet: !isExpense ? orNull(street) : (parsed?.customerStreet ?? null),
          customerCity: !isExpense ? orNull(city) : (parsed?.customerCity ?? null),
          customerZip: !isExpense ? orNull(zip) : (parsed?.customerZip ?? null),
          // Platba
          variableSymbol: orNull(variableSymbol),
          bankAccount: orNull(bankAccount),
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
                      .trim() || t("cash_payment_default"),
                  merchant: orNull(merchant),
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
      // Pokud doklad pochází ze scan-fronty, smaž záznam — už je v hlavní DB
      if (preExtracted?.queueRecordId) {
        try { await deleteRecord(preExtracted.queueRecordId); } catch (_) { /* ignore */ }
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
        title={mode === "scan" ? t("scan_title") : t("upload_title")}
        onClose={onClose}
        onSave={onParse}
        saving={parsing}
        error={err}
        saveLabel={t("load_via_ai")}
        saveDisabled={!file}
      >
        <p className="text-sm text-ink-600">
          {mode === "scan"
            ? t("scan_subtitle")
            : t("upload_subtitle")}
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
        {queuedNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            ⏳ {queuedNotice}
          </div>
        )}
      </FormDialog>
    );
  }

  // Fáze 2: review extracted data
  return (
    <FormDialog
      title={docType === "receipt" ? t("review_receipt") : t("review_invoice")}
      onClose={onClose}
      onSave={save}
      saving={saving}
      error={err}
      saveLabel={docType === "receipt" ? t("save_receipt") : t("save_invoice")}
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
          <Field label={t("invoice_number")}>
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
            ? t("merchant")
            : isExpense
              ? t("supplier")
              : t("customer")
        }
      >
        <input
          type="text"
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
          className={inputClass}
        />
      </Field>

      {/* IČO + DIČ — pro Pohoda XML export jsou klíčové, AI je extrahuje.
          Tlačítko "Najít v ARES" doplní název + DIČ + adresu z veřejného
          registru (užitečné když AI IČO sice extrahovalo, ale adresu špatně). */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="IČO">
          <div className="flex gap-2">
            <input
              type="text"
              value={ico}
              onChange={(e) => setIco(e.target.value)}
              placeholder="12345678"
              maxLength={8}
              className={`${inputClass} font-mono flex-1`}
            />
            <button
              type="button"
              onClick={() => {
                aresLookedUpFor.current = null; // umožni re-lookup pro stejné IČO
                lookupAres(false);
              }}
              disabled={ico.replace(/\D/g, "").length < 6 || aresLoading}
              className="h-10 px-3 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium text-ink-700 whitespace-nowrap"
              title="Vyhledat firmu v registru ARES (název, DIČ, adresa)"
            >
              {aresLoading ? "⏳" : "🔍 ARES"}
            </button>
          </div>
        </Field>
        <Field label="DIČ">
          <input
            type="text"
            value={dic}
            onChange={(e) => setDic(e.target.value)}
            placeholder="CZ12345678"
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>
      {aresError && (
        <div className="text-xs text-amber-700 -mt-2">{aresError}</div>
      )}
      {aresInfo && !aresError && (
        <div className="text-xs text-emerald-700 -mt-2">{aresInfo}</div>
      )}

      {/* Adresa (collapsible — typicky stačí AI extrahované; user může upravit) */}
      <details className="text-sm">
        <summary className="cursor-pointer text-ink-600 hover:text-ink-900 select-none">
          ▾ Adresa partnera{(street || city || zip) && " (vyplněno)"}
        </summary>
        <div className="mt-2 space-y-2">
          <Field label="Ulice + č.p.">
            <input
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <Field label="Město">
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="PSČ">
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="11000"
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
        </div>
      </details>

      {/* Provozovna — pouze pro účtenky. Server-side pole (Pohoda XML export
          ji ignoruje); slouží pro lepší identifikaci konkrétní pobočky. */}
      {docType === "receipt" && (
        <Field label="Provozovna (pobočka)">
          <input
            type="text"
            value={provozovna}
            onChange={(e) => setProvozovna(e.target.value)}
            placeholder="Např. Albert Jihlava — Náměstí Svobody"
            className={inputClass}
          />
          <p className="text-xs text-ink-500 mt-1">
            Volitelné — konkrétní pobočka, jak je na účtence. Neexportuje se do Pohody.
          </p>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={docType === "receipt" ? t("date") : t("issue_date")}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        {docType === "receipt" ? (
          <Field label={t("time")}>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className={inputClass}
            />
          </Field>
        ) : (
          <Field label={t("due_date")}>
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
          <Field label={t("total_with_vat")}>
            <input
              type="text"
              inputMode="decimal"
              value={totalWithVat}
              onChange={(e) => setTotalWithVat(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label={t("currency")}>
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
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("vs")}>
              <input
                type="text"
                value={variableSymbol}
                onChange={(e) => setVariableSymbol(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field label="Bankovní účet (pro platbu)">
              <input
                type="text"
                value={bankAccount}
                onChange={(e) => setBankAccount(e.target.value)}
                placeholder="123456789/0800"
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
        </>
      ) : (
        <Field label={t("payment_method")}>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className={inputClass}
          >
            <option value="CARD">{t("payment_card")}</option>
            <option value="CASH">{t("payment_cash")}</option>
            <option value="UNKNOWN">{t("payment_unknown")}</option>
          </select>
        </Field>
      )}

      {paymentMethod === "CASH" ? (
        <Field label={t("account")}>
          <div className="h-10 rounded-lg border border-ink-300 bg-ink-50 px-3 flex items-center text-sm text-ink-700">
            {t("cash_locked")}
          </div>
        </Field>
      ) : (
        <Field label={t("account")}>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className={inputClass}
          >
            {nonCashAccounts.length === 0 && (
              <option value="">{t("no_account")}</option>
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
            {tInvEditor("items")} ({parsed.items.length})
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
        <Field label={t("note")}>
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
