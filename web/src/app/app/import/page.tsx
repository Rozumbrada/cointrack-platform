"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSyncData } from "@/lib/sync-hook";
import { ServerAccount } from "@/lib/sync-types";
import { sync } from "@/lib/api";
import { withAuth } from "@/lib/auth-store";

interface ParsedRow {
  raw: string[];
  date?: string;            // YYYY-MM-DD
  amount?: number;          // signed
  currency?: string;
  description?: string;
  counterparty?: string;
  vs?: string;
  bankTxId?: string;
}

interface ColumnMap {
  date: number;
  amount: number;
  currency?: number;
  description?: number;
  counterparty?: number;
  vs?: number;
  bankTxId?: number;
}

export default function ImportCsvPage() {
  const t = useTranslations("import_csv");
  const { profileSyncId, entitiesByProfile, reload } = useSyncData();
  const accounts = entitiesByProfile<ServerAccount>("accounts");
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [accountSyncId, setAccountSyncId] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ─── Parsing ──────────────────────────────────────────────────────
  const parsed = useMemo(() => parseCsv(rawText), [rawText]);
  const columnMap = useMemo(() => detectColumns(parsed.headers), [parsed.headers]);
  const [manualMap, setManualMap] = useState<Partial<ColumnMap>>({});
  const effectiveMap: ColumnMap | null = useMemo(() => {
    const merged = { ...columnMap, ...manualMap };
    if (merged.date == null || merged.amount == null) return null;
    return merged as ColumnMap;
  }, [columnMap, manualMap]);

  const rows: ParsedRow[] = useMemo(() => {
    if (!effectiveMap) return [];
    return parsed.rows.map((r) => mapRow(r, effectiveMap));
  }, [parsed.rows, effectiveMap]);

  const validCount = rows.filter((r) => r.date && r.amount != null).length;

  async function onFile(f: File) {
    setFile(f);
    setError(null);
    setStatus(null);
    setManualMap({});
    try {
      const text = await readAsText(f);
      setRawText(text);
    } catch (e) {
      setError(t("read_failed", { error: String(e) }));
    }
  }

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, []);

  async function onImport() {
    if (!effectiveMap || !accountSyncId || !profileSyncId || rows.length === 0) return;
    setImporting(true);
    setError(null);
    setStatus(t("uploading"));
    try {
      const now = new Date().toISOString();
      const entities = rows
        .filter((r) => r.date && r.amount != null)
        .map((r) => ({
          syncId: crypto.randomUUID(),
          updatedAt: now,
          deletedAt: null,
          clientVersion: 1,
          data: {
            profileId: profileSyncId,
            accountId: accountSyncId,
            amount: String(r.amount),
            currency: r.currency || "CZK",
            description: r.description || null,
            merchant: r.counterparty || null,
            date: r.date,
            isTransfer: false,
            bankTxId: r.bankTxId || null,
            bankVs: r.vs || null,
            bankCounterparty: r.counterparty || null,
          },
        }));

      // Push v dávkách po 100, aby požadavek nebyl moc velký.
      const batchSize = 100;
      let pushed = 0;
      for (let i = 0; i < entities.length; i += batchSize) {
        const batch = entities.slice(i, i + batchSize);
        await withAuth((t) =>
          sync.push(t, { entities: { transactions: batch } }),
        );
        pushed += batch.length;
        setStatus(t("uploading_progress", { pushed, total: entities.length }));
      }
      setStatus(t("imported", { count: pushed }));
      await reload();
    } catch (e) {
      setError(t("import_failed", { error: e instanceof Error ? e.message : String(e) }));
      setStatus(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-ink-900">{t("title")}</h1>
        <p className="text-sm text-ink-600 mt-1">{t("subtitle")}</p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="bg-white rounded-2xl border-2 border-dashed border-ink-300 p-8 text-center"
      >
        {file ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-ink-900">📄 {file.name}</div>
            <div className="text-xs text-ink-600">{(file.size / 1024).toFixed(1)} KB</div>
            <button
              onClick={() => { setFile(null); setRawText(""); setManualMap({}); }}
              className="text-sm text-red-600 hover:underline"
            >
              {t("remove")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-ink-600">{t("drop_here")}</div>
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              className="block mx-auto text-sm"
            />
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">{error}</div>
      )}

      {/* Detection results */}
      {parsed.headers.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
          <h2 className="font-semibold text-ink-900">{t("detection_title")}</h2>
          <div className="text-sm text-ink-600">
            {t("delimiter")} <code>{parsed.delimiter}</code> · {t("rows_detected", { n: parsed.rows.length })}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ColumnPicker label={t("col_date")} value={effectiveMap?.date} headers={parsed.headers}
              onChange={(v) => setManualMap((m) => ({ ...m, date: v }))} />
            <ColumnPicker label={t("col_amount")} value={effectiveMap?.amount} headers={parsed.headers}
              onChange={(v) => setManualMap((m) => ({ ...m, amount: v }))} />
            <ColumnPicker label={t("col_currency")} value={effectiveMap?.currency} headers={parsed.headers}
              onChange={(v) => setManualMap((m) => ({ ...m, currency: v }))} />
            <ColumnPicker label={t("col_description")} value={effectiveMap?.description} headers={parsed.headers}
              onChange={(v) => setManualMap((m) => ({ ...m, description: v }))} />
            <ColumnPicker label={t("col_counterparty")} value={effectiveMap?.counterparty} headers={parsed.headers}
              onChange={(v) => setManualMap((m) => ({ ...m, counterparty: v }))} />
            <ColumnPicker label={t("col_vs")} value={effectiveMap?.vs} headers={parsed.headers}
              onChange={(v) => setManualMap((m) => ({ ...m, vs: v }))} />
          </div>
          {!effectiveMap && (
            <div className="text-xs text-amber-700">
              {t("select_date_amount")}
            </div>
          )}
        </section>
      )}

      {/* Preview */}
      {effectiveMap && rows.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
          <h2 className="font-semibold text-ink-900">
            {t("preview_title", { valid: validCount, total: rows.length })}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-xs text-ink-600 uppercase">
                <tr>
                  <th className="text-left p-2">{t("th_date")}</th>
                  <th className="text-right p-2">{t("th_amount")}</th>
                  <th className="text-left p-2">{t("th_description")}</th>
                  <th className="text-left p-2">{t("th_counterparty")}</th>
                  <th className="text-left p-2">{t("th_vs")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-ink-100">
                    <td className="p-2">{r.date || "—"}</td>
                    <td className={`p-2 text-right font-mono ${(r.amount ?? 0) < 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {r.amount != null ? r.amount.toFixed(2) : "—"}
                    </td>
                    <td className="p-2 max-w-xs truncate">{r.description || "—"}</td>
                    <td className="p-2 max-w-xs truncate">{r.counterparty || "—"}</td>
                    <td className="p-2">{r.vs || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 8 && (
              <div className="text-xs text-ink-500 mt-2">{t("preview_more", { n: rows.length - 8 })}</div>
            )}
          </div>
        </section>
      )}

      {/* Account picker + import */}
      {effectiveMap && rows.length > 0 && (
        <section className="bg-white rounded-2xl border border-ink-200 p-6 space-y-4">
          <h2 className="font-semibold text-ink-900">{t("target_account")}</h2>
          <select
            value={accountSyncId}
            onChange={(e) => setAccountSyncId(e.target.value)}
            className="w-full h-10 rounded-lg border border-ink-300 bg-white px-3 text-sm"
          >
            <option value="">{t("select_account")}</option>
            {accounts.map((a) => (
              <option key={a.syncId} value={a.syncId}>
                {a.data.name} ({a.data.currency})
              </option>
            ))}
          </select>

          {status && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-900">
              {status}
            </div>
          )}

          <button
            onClick={onImport}
            disabled={!accountSyncId || importing || validCount === 0}
            className="h-10 px-6 rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium"
          >
            {importing ? t("importing_btn") : t("import_btn", { count: validCount })}
          </button>
        </section>
      )}
    </div>
  );
}

// ─── ColumnPicker ─────────────────────────────────────────────────────
function ColumnPicker({
  label,
  value,
  headers,
  onChange,
}: {
  label: string;
  value: number | undefined;
  headers: string[];
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="space-y-1">
      <div className="text-xs text-ink-600">{label}</div>
      <select
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : Number(e.target.value))
        }
        className="w-full h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm"
      >
        <option value="">—</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Sloupec ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

// ─── CSV parser ───────────────────────────────────────────────────────
interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

function parseCsv(text: string): ParsedCsv {
  if (!text) return { headers: [], rows: [], delimiter: "" };
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Detekce oddělovače — bere ten, co se nejčastěji objeví v prvních řádcích
  const delim = detectDelimiter(lines.slice(0, 10));
  // Najít header — Fio CSV má metadata, header je typicky řádek obsahující "Datum" nebo "Date"
  let headerIdx = lines.findIndex((l) => /Datum|Date|Objem|Amount|Castka|Částka/i.test(l));
  if (headerIdx === -1) headerIdx = 0;
  const headers = parseLine(lines[headerIdx], delim);
  const rows = lines.slice(headerIdx + 1).map((l) => parseLine(l, delim));
  return { headers, rows, delimiter: delim };
}

function parseLine(line: string, delim: string): string[] {
  // Jednoduchý parser s podporou uvozovek
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === delim) { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function detectDelimiter(lines: string[]): string {
  const candidates = [";", ",", "\t", "|"];
  let best = ";";
  let bestCount = 0;
  for (const d of candidates) {
    const count = lines.reduce((acc, l) => acc + (l.split(d).length - 1), 0);
    if (count > bestCount) { bestCount = count; best = d; }
  }
  return best;
}

// ─── Header → column index detection ──────────────────────────────────
function detectColumns(headers: string[]): Partial<ColumnMap> {
  const find = (...patterns: RegExp[]): number | undefined => {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (patterns.some((p) => p.test(h))) return i;
    }
    return undefined;
  };
  return {
    date:        find(/^datum/i, /^date/i, /datum.*odep/i),
    amount:      find(/^objem/i, /^částka$/i, /^castka$/i, /^amount$/i, /^částka v měně účtu/i),
    currency:    find(/^měna$/i, /^mena$/i, /^currency$/i),
    description: find(/zpráva/i, /zprava/i, /^poznámka/i, /^poznamka/i, /^popis/i, /^description/i, /^message/i),
    counterparty: find(/název protiúčtu/i, /protistrana/i, /counterparty/i, /payee/i),
    vs:          find(/^vs/i, /variabilní/i, /variable.*symbol/i),
    bankTxId:    find(/^id pohybu/i, /^transaction.*id/i),
  };
}

// ─── Map row → ParsedRow ──────────────────────────────────────────────
function mapRow(raw: string[], m: ColumnMap): ParsedRow {
  const get = (idx?: number) => (idx == null ? undefined : raw[idx]?.trim() || undefined);
  return {
    raw,
    date: parseDate(get(m.date)),
    amount: parseAmount(get(m.amount)),
    currency: get(m.currency),
    description: get(m.description),
    counterparty: get(m.counterparty),
    vs: get(m.vs),
    bankTxId: get(m.bankTxId),
  };
}

function parseDate(s?: string): string | undefined {
  if (!s) return undefined;
  // dd.MM.yyyy → yyyy-MM-dd
  const m1 = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(s);
  if (m1) return `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
  // yyyy-MM-dd → as-is
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  // dd/MM/yyyy
  const m3 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m3) return `${m3[3]}-${m3[2].padStart(2, "0")}-${m3[1].padStart(2, "0")}`;
  return undefined;
}

function parseAmount(s?: string): number | undefined {
  if (!s) return undefined;
  // "-1234,56", "1 234.56", "-1,234.56"
  const cleaned = s.replace(/\s/g, "").replace(/[^\d,.\-+]/g, "");
  // Pokud má jen čárku, asi je to desetinná
  let normalized = cleaned;
  if (cleaned.includes(",") && !cleaned.includes(".")) {
    normalized = cleaned.replace(",", ".");
  } else if (cleaned.includes(",") && cleaned.includes(".")) {
    // 1,234.56 — čárka tisíce, tečka desetinná
    normalized = cleaned.replace(/,/g, "");
  }
  const n = parseFloat(normalized);
  return isFinite(n) ? n : undefined;
}

// ─── File → text (s detekcí kódování) ─────────────────────────────────
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      // Zkusit UTF-8 nejdřív
      let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      // Heuristika: pokud obsahuje typické znaky pro CP1250, zkus to
      if (/Ã.|Ä.|�/.test(text)) {
        try {
          const decoder = new TextDecoder("windows-1250");
          text = decoder.decode(buf);
        } catch { /* ignore */ }
      }
      resolve(text);
    };
    reader.readAsArrayBuffer(file);
  });
}
