"use client";

import { useState } from "react";
import { ParsedDocument } from "@/lib/gemini";
import { useScanQueue } from "@/lib/scan-queue-hook";
import { ScanQueueRecord } from "@/lib/scan-queue";
import { DocumentDialog } from "./DocumentDialog";

/**
 * Souhrnná kartička scan-fronty na dashboardu — zobrazí se POUZE když
 * jsou v IndexedDB nějaké položky pro aktivní profil. Klik rozbalí list
 * jednotlivých dokladů s akcemi (potvrdit & uložit / smazat / retry).
 *
 * Background processor (z `useScanQueue`) automaticky retry-uje pending
 * položky po online eventu nebo periodicky každých 30s.
 */
export function ScanQueueCard({ profileSyncId }: { profileSyncId: string }) {
  const { items, isProcessing, remove, retryNow, refresh } = useScanQueue(profileSyncId);
  const [expanded, setExpanded] = useState(false);
  const [reviewing, setReviewing] = useState<ScanQueueRecord | null>(null);

  if (items.length === 0) return null;

  const ready = items.filter((i) => i.status === "ready");
  const pending = items.filter((i) => i.status === "pending" || i.status === "processing");
  const failed = items.filter((i) => i.status === "failed");

  const title = (() => {
    if (ready.length > 0 && pending.length === 0 && failed.length === 0) {
      return ready.length === 1
        ? "1 doklad připraven k uložení"
        : `${ready.length} dokladů připraveno k uložení`;
    }
    if (ready.length > 0) {
      return `${ready.length} k potvrzení · ${pending.length + failed.length} čeká`;
    }
    if (pending.length > 0) {
      return pending.length === 1 ? "1 doklad ve frontě" : `${pending.length} dokladů ve frontě`;
    }
    if (failed.length > 0) return `${failed.length} neúspěšný doklad`;
    return "Scan fronta";
  })();

  const subtitle = (() => {
    if (ready.length > 0) return "Klikni a potvrď uložení.";
    if (pending.length > 0) return "Čeká na AI rozpoznání. Zpracujeme jak to půjde.";
    if (failed.length > 0) return "Selhalo — klikni pro detail.";
    return "";
  })();

  const accent = ready.length > 0
    ? "border-brand-300 bg-brand-50 text-brand-900"
    : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <>
      <section className={`rounded-2xl border ${accent}`}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center gap-3 p-4 text-left"
        >
          <div className="text-2xl">
            {ready.length > 0 ? "✅" : pending.length > 0 ? "⏳" : "⚠️"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">{title}</div>
            {subtitle && <div className="text-xs opacity-80">{subtitle}</div>}
          </div>
          <div className="text-xs opacity-60">{expanded ? "▲" : "▼"}</div>
        </button>

        {expanded && (
          <div className="px-4 pb-4 space-y-2">
            {items.map((item) => (
              <ScanQueueItemRow
                key={item.id}
                item={item}
                onReview={() => setReviewing(item)}
                onDelete={() => remove(item.id)}
              />
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={retryNow}
                disabled={isProcessing}
                className="text-xs px-3 py-1.5 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 disabled:opacity-50"
              >
                {isProcessing ? "Zkouším…" : "Zkusit znovu"}
              </button>
            </div>
          </div>
        )}
      </section>

      {reviewing && reviewing.parsed && (
        <DocumentDialog
          mode="upload"
          onClose={async () => {
            setReviewing(null);
            await refresh();
          }}
          preExtracted={{
            parsed: reviewing.parsed,
            storageKey: reviewing.storageKey,
            queueRecordId: reviewing.id,
          }}
        />
      )}
    </>
  );
}

function ScanQueueItemRow({
  item,
  onReview,
  onDelete,
}: {
  item: ScanQueueRecord;
  onReview: () => void;
  onDelete: () => void;
}) {
  const status = item.status;
  const dot =
    status === "ready"
      ? "bg-emerald-500"
      : status === "pending" || status === "processing"
      ? "bg-amber-500 animate-pulse"
      : "bg-red-500";

  const statusLabel =
    status === "ready"
      ? "Připraveno"
      : status === "processing"
      ? "Zpracovává se…"
      : status === "pending"
      ? "Čeká na AI"
      : "Chyba";

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3 flex items-center gap-3">
      <span className={`w-2.5 h-2.5 rounded-full ${dot} flex-shrink-0`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink-900 truncate">{item.fileName}</div>
        <div className="text-xs text-ink-500">
          {statusLabel} · {(item.fileSize / 1024 / 1024).toFixed(2)} MB
        </div>
        {item.lastError && status !== "ready" && (
          <div className="text-xs text-red-600 mt-0.5 truncate">{item.lastError}</div>
        )}
      </div>
      {status === "ready" && (
        <button
          type="button"
          onClick={onReview}
          className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700"
        >
          Potvrdit
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        title="Smazat z fronty"
        className="text-xs px-2 py-1.5 rounded-lg text-ink-600 hover:bg-ink-100"
      >
        ✕
      </button>
    </div>
  );
}
