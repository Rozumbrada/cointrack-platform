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

const DOCUMENT_PROMPT = `Jsi expert na extrakci dat z českých daňových dokladů.

Z přiloženého obrázku/PDF rozpoznej typ dokumentu (účtenka vs. faktura) a extrahuj data.

Typy:
- "receipt" = pokladní účtenka / paragon (typicky termální papír, hotovost/karta, kup v obchodě, krátký seznam položek, často bez čísla nebo s pořadovým číslem účtenky/EET)
- "invoice" = faktura (dodavatel a odběratel, číslo faktury, IČO/DIČ, splatnost, často variabilní symbol, bankovní účet)

Vrať POUZE validní JSON bez markdownu nebo dalšího textu:
{
  "docType": "receipt" | "invoice",
  "merchantName": string|null,
  "merchantIco": string|null,
  "merchantDic": string|null,
  "merchantStreet": string|null,
  "merchantCity": string|null,
  "merchantZip": string|null,
  "date": "YYYY-MM-DD"|null,
  "time": "HH:MM"|null,
  "totalWithVat": number|null,
  "totalWithoutVat": number|null,
  "currency": "CZK"|"EUR"|"USD",
  "paymentMethod": "CASH"|"CARD"|"BANK_TRANSFER"|"OTHER"|"UNKNOWN",

  // Pouze pokud docType=="invoice":
  "invoiceNumber": string|null,
  "issueDate": "YYYY-MM-DD"|null,
  "dueDate": "YYYY-MM-DD"|null,
  "supplierName": string|null,
  "supplierIco": string|null,
  "supplierDic": string|null,
  "supplierStreet": string|null,
  "supplierCity": string|null,
  "supplierZip": string|null,
  "customerName": string|null,
  "variableSymbol": string|null,
  "bankAccount": string|null,
  "isExpense": boolean,

  "items": [
    {
      "name": string,
      "quantity": number,
      "totalPrice": number,    // cena s DPH
      "vatRate": number        // 0|10|12|21
    }
  ]
}

Pravidla:
- Částky jako desetinná čísla (125.90), null pro chybějící hodnoty.
- isExpense=true pokud jsme odběratel (customer), false pokud jsme dodavatel.
- Pokud položky nejsou rozlišitelné, vrať jednu položku "Nákup".
- Účtenka má docType="receipt" a date+time; faktura má docType="invoice" a issueDate+dueDate.`;

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
  merchantName?: string | null;
  merchantIco?: string | null;
  merchantDic?: string | null;
  merchantStreet?: string | null;
  merchantCity?: string | null;
  merchantZip?: string | null;
  date?: string | null;
  time?: string | null;
  totalWithVat?: number | null;
  totalWithoutVat?: number | null;
  currency?: string;
  paymentMethod?: string;
  invoiceNumber?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  supplierName?: string | null;
  supplierIco?: string | null;
  supplierDic?: string | null;
  supplierStreet?: string | null;
  supplierCity?: string | null;
  supplierZip?: string | null;
  customerName?: string | null;
  variableSymbol?: string | null;
  bankAccount?: string | null;
  isExpense?: boolean;
  items?: Array<{
    name: string;
    quantity?: number;
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
