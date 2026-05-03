/**
 * Helper pro upload souborů a extrakci dat přes backend Gemini proxy.
 * Backend endpoint: /api/v1/ai/gemini/{model} (přepošle na Google s api klíčem).
 */

import { api } from "./api";

const MODEL = "gemini-3.1-flash-lite-preview";

export interface UploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
}

/** Požádá backend o presigned URL a PUTne soubor do MinIO. Vrací storage key. */
export async function uploadFile(
  token: string,
  file: File,
  purpose: "receipt" | "invoice" | "warranty" | "loyalty",
): Promise<string> {
  const meta = await api<UploadUrlResponse>("/api/v1/files/upload-url", {
    method: "POST",
    token,
    body: {
      contentType: file.type,
      purpose,
      sizeBytes: file.size,
    },
  });

  const putRes = await fetch(meta.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload selhal: HTTP ${putRes.status}`);
  }
  return meta.storageKey;
}

/** Image file → base64 string (bez `data:` prefixu). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Nepodařilo se přečíst soubor."));
    reader.readAsDataURL(file);
  });
}

// Port mobilního ReceiptGeminiExtractor + InvoiceGeminiExtractor pravidel.
// Jednotný prompt s detekcí typu (receipt/invoice) + všechna pole obou exporterů.
const DOCUMENT_PROMPT = `Jsi expert na extrakci dat z českých daňových dokladů — účtenek, paragonů, pokladních dokladů a faktur.

Z přiloženého obrázku (nebo PDF, může být víc stránek pro vícestránkovou fakturu) rozpoznej typ dokumentu a extrahuj VŠECHNA dostupná data.

Typy:
- "receipt" = pokladní účtenka / paragon — typicky termální papír, hotovost/karta, krátký seznam položek, často bez čísla nebo s pořadovým číslem EET. Adresa obchodu obvykle v záhlaví.
- "invoice" = faktura / daňový doklad — dodavatel a odběratel s plnou adresou, číslo faktury, IČO/DIČ obou stran, splatnost, variabilní symbol, bankovní účet.

Vrať POUZE validní JSON bez markdownu, bez dalšího textu, bez vysvětlení:
{
  "docType": "receipt" | "invoice",

  // ÚČTENKA — header obchodu
  "merchantName": "název obchodníka nebo firmy (string nebo null)",
  "merchantIco": "IČO - PŘESNĚ 8 číslic bez mezer (string nebo null)",
  "merchantDic": "DIČ ve formátu CZxxxxxxxx (string nebo null)",
  "merchantStreet": "ulice a číslo popisné (string nebo null)",
  "merchantCity": "název města (string nebo null)",
  "merchantZip": "PSČ bez mezer, 5 číslic (string nebo null)",
  "provozovna": "název konkrétní pobočky/provozovny tak jak je uveden na účtence — např. 'Albert Jihlava — Náměstí Svobody', 'Lidl Chodov'. POUZE pro účtenky (docType=receipt). Pokud na účtence není uveden název pobočky, vrať null (string nebo null)",

  // ÚČTENKA — datum + čas + EET
  "date": "datum ve formátu YYYY-MM-DD (string nebo null)",
  "time": "čas ve formátu HH:MM (string nebo null)",

  // SPOLEČNÉ částky
  "totalWithVat": "celková částka K ÚHRADĚ včetně DPH (číslo nebo null)",
  "totalWithoutVat": "celkový základ daně bez DPH (číslo nebo null)",
  "currency": "CZK | EUR | USD (default CZK)",
  "paymentMethod": "CASH (hotově) | CARD (kartou) | BANK_TRANSFER (převodem) | OTHER | UNKNOWN",

  // FAKTURA — vyplň jen pokud docType==invoice
  "invoiceNumber": "číslo faktury (string nebo null)",
  "issueDate": "datum vystavení YYYY-MM-DD (string nebo null)",
  "dueDate": "datum splatnosti YYYY-MM-DD (string nebo null)",

  // FAKTURA — dodavatel
  "supplierName": "název dodavatele (string nebo null)",
  "supplierIco": "IČO dodavatele - PŘESNĚ 8 číslic (string nebo null)",
  "supplierDic": "DIČ dodavatele ve formátu CZxxxxxxxx (string nebo null)",
  "supplierStreet": "ulice + číslo popisné dodavatele (string nebo null)",
  "supplierCity": "město dodavatele (string nebo null)",
  "supplierZip": "PSČ dodavatele bez mezer (string nebo null)",

  // FAKTURA — odběratel
  "customerName": "název odběratele (string nebo null)",
  "customerIco": "IČO odběratele - PŘESNĚ 8 číslic (string nebo null)",
  "customerDic": "DIČ odběratele ve formátu CZxxxxxxxx (string nebo null)",
  "customerStreet": "ulice + číslo popisné odběratele (string nebo null)",
  "customerCity": "město odběratele (string nebo null)",
  "customerZip": "PSČ odběratele (string nebo null)",

  // FAKTURA — platba
  "variableSymbol": "variabilní symbol pro platbu (string nebo null)",
  "bankAccount": "číslo účtu pro platbu ve formátu číslo/kód, IBAN nebo jen číslo (string nebo null)",
  "bankCode": "kód banky - 4 číslice (např. 0800, 0100, 2010), null pro IBAN (string nebo null)",
  "isExpense": "true pokud JSME odběratel (přijatá faktura), false pokud JSME dodavatel (vystavená)",

  // SPOLEČNÉ — položky
  "items": [
    {
      "name": "název položky (string)",
      "quantity": "množství (číslo, default 1.0)",
      "unit": "jednotka ks/kg/l/g/m/hod (string nebo null)",
      "unitPriceWithoutVat": "cena BEZ DPH za 1 jednotku (číslo nebo null)",
      "totalPrice": "celková cena položky S DPH (číslo)",
      "vatRate": "sazba DPH v % - 0, 10, 12 nebo 21 (integer)"
    }
  ]
}

Důležitá pravidla:
- Pokud hodnota není v dokumentu, použij null (ne prázdný string "").
- Provozovna != merchantName. merchantName je oficiální firma (např. "Albert ČR s.r.o."),
  provozovna je název konkrétní pobočky/obchodu tak jak je vytištěn na účtence
  (např. "Albert Jihlava — Náměstí Svobody"). Provozovnu plň POUZE u docType=receipt.
  U faktur (docType=invoice) ji nech null. Neopisuj jen adresu — provozovna je název.
- Částky jsou desetinná čísla — 125.90, ne "125,90" ani "125 Kč".
- IČO je VŽDY 8 číslic — pokud najdeš méně, doplň nulami zleva (12345 → "00012345").
- DIČ má prefix země: "CZ12345678", pro SK "SK...", apod.
- Sazby DPH v ČR: 0%, 10%, 12%, 21% — přiřaď nejbližší platnou.
- isExpense=true pokud JSME zákazník (faktura na nás od dodavatele = výdaj).
  isExpense=false pokud JSME ten, kdo fakturu vystavil (= příjem). Když nejsi schopen rozhodnout, použij true.
- Účtenka: docType="receipt" + date + time. Faktura: docType="invoice" + issueDate + dueDate.
- Pokud položky nelze rozlišit nebo jsou jen souhrnem, vrať JEDNU položku "Nákup" s totalPrice = totalWithVat.
- Ignoruj čárové kódy, QR kódy, EET kódy a obrázky log.
- U faktury, kde je odběratel JEN tvoje firma jako string, můžeš použít supplierName/customerName analogicky podle isExpense.`;

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

export interface ParsedDocument {
  docType: "receipt" | "invoice";

  // Merchant (receipt header)
  merchantName?: string | null;
  merchantIco?: string | null;
  merchantDic?: string | null;
  merchantStreet?: string | null;
  merchantCity?: string | null;
  merchantZip?: string | null;
  /**
   * Provozovna — konkrétní pobočka obchodu, jak je uvedená na účtence.
   * Server-side pole, Pohoda XML export ji ignoruje.
   */
  provozovna?: string | null;

  date?: string | null;
  time?: string | null;
  totalWithVat?: number | null;
  totalWithoutVat?: number | null;
  currency?: string;
  paymentMethod?: string;

  // Invoice
  invoiceNumber?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;

  // Supplier
  supplierName?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  supplierStreet?: string | null;
  supplierCity?: string | null;
  supplierZip?: string | null;

  // Customer
  customerName?: string | null;
  customerIco?: string | null;
  customerDic?: string | null;
  customerStreet?: string | null;
  customerCity?: string | null;
  customerZip?: string | null;

  // Payment routing
  variableSymbol?: string | null;
  bankAccount?: string | null;
  bankCode?: string | null;
  isExpense?: boolean;

  items?: Array<{
    name: string;
    quantity?: number;
    unit?: string | null;
    unitPriceWithoutVat?: number | null;
    totalPrice?: number;
    vatRate?: number;
  }>;
}

/**
 * Pošle obrázek/PDF do Gemini, AI sama rozpozná, jestli je to účtenka nebo
 * faktura, a vrátí strukturovaná data s polem `docType`.
 */
export async function extractDocument(
  token: string,
  file: File,
): Promise<ParsedDocument> {
  const base64 = await fileToBase64(file);

  const requestBody = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: file.type, data: base64 } },
          { text: DOCUMENT_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  const res = await api<GeminiResponse>(`/api/v1/ai/gemini/${MODEL}`, {
    method: "POST",
    token,
    body: requestBody,
  });

  const text = res.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text;
  if (!text) {
    throw new Error("Gemini nevrátilo žádná data.");
  }

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as ParsedDocument;
  } catch {
    throw new Error(`Nepodařilo se parsovat odpověď AI: ${cleaned.slice(0, 200)}`);
  }
}
