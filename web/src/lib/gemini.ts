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

const RECEIPT_PROMPT = `Jsi expert na extrakci dat z českých účtenek a paragonů.

Z přiloženého obrázku extrahuj data a vrať POUZE validní JSON bez dalšího textu nebo markdownu.

Formát:
{
  "merchantName": string|null,
  "date": "YYYY-MM-DD"|null,
  "time": "HH:MM"|null,
  "totalWithVat": number|null,
  "totalWithoutVat": number|null,
  "currency": "CZK"|"EUR"|"USD",
  "paymentMethod": "CASH"|"CARD"|"UNKNOWN",
  "items": [
    { "name": string, "quantity": number, "totalPrice": number, "vatRate": number }
  ]
}

Pravidla: částky jako desetinná čísla (125.90), null pro chybějící hodnoty, pokud položky nejsou rozlišitelné, vrať jednu položku "Nákup".`;

const INVOICE_PROMPT = `Jsi expert na extrakci dat z českých faktur.

Z přiložené faktury (obrázek nebo PDF) extrahuj data a vrať POUZE validní JSON bez dalšího textu.

Formát:
{
  "invoiceNumber": string|null,
  "issueDate": "YYYY-MM-DD"|null,
  "dueDate": "YYYY-MM-DD"|null,
  "totalWithVat": number|null,
  "totalWithoutVat": number|null,
  "currency": "CZK"|"EUR"|"USD",
  "supplierName": string|null,
  "supplierIco": string|null,
  "supplierDic": string|null,
  "customerName": string|null,
  "variableSymbol": string|null,
  "bankAccount": string|null,
  "paymentMethod": "BANK_TRANSFER"|"CASH"|"CARD"|"OTHER",
  "isExpense": boolean,
  "items": [
    { "name": string, "quantity": number, "totalPriceWithVat": number, "vatRate": number }
  ]
}

Pravidla: isExpense=true pokud jsme příjemci (customer), false pokud my jsme dodavatel. null pro chybějící hodnoty. Datumy YYYY-MM-DD.`;

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

/** Pošle obrázek/PDF do Gemini a vrátí parsovaný JSON. */
export async function extractDocument<T>(
  token: string,
  file: File,
  type: "receipt" | "invoice",
): Promise<T> {
  const base64 = await fileToBase64(file);
  const prompt = type === "receipt" ? RECEIPT_PROMPT : INVOICE_PROMPT;

  const requestBody = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: file.type, data: base64 } },
          { text: prompt },
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

  // Někdy Gemini obalí JSON do ```json ... ```
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Nepodařilo se parsovat odpověď AI: ${cleaned.slice(0, 200)}`);
  }
}
