"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { withAuth } from "./auth-store";
import { extractDocument, uploadFile } from "./gemini";
import {
  ScanQueueRecord,
  deleteRecord,
  enqueueFile,
  getPendingForRetry,
  listForProfile,
  resetStuckProcessing,
  updateRecord,
} from "./scan-queue";

/**
 * Hook pro reaktivní práci se scan-frontou v komponentě. Drží lokální seznam,
 * po každé akci (enqueue/retry/delete/process) refreshuje z IndexedDB a
 * automaticky spouští processor pro PENDING položky.
 *
 * Background processing běží:
 *   • při mount (jednorázově po načtení)
 *   • při window.online (= síť se vrátila)
 *   • setInterval každých 30s, dokud existují pending položky
 *   • na manuální `retryNow()` (např. tlačítko)
 */
export function useScanQueue(profileSyncId: string | null) {
  const [items, setItems] = useState<ScanQueueRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const lockRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!profileSyncId) {
      setItems([]);
      return;
    }
    const list = await listForProfile(profileSyncId);
    setItems(list);
  }, [profileSyncId]);

  const processPending = useCallback(async () => {
    if (lockRef.current) return; // už běží — neodpalovat paralelně
    lockRef.current = true;
    setIsProcessing(true);
    try {
      await resetStuckProcessing();
      const pending = await getPendingForRetry();
      for (const item of pending) {
        // Obnov si lock-status v DB
        await updateRecord(item.id, {
          status: "processing",
          lastAttemptAt: Date.now(),
        });
        try {
          // Refresh File z Blob — gemini.ts očekává File, takže ho z Blob postavíme
          const file = new File([item.fileBlob], item.fileName, {
            type: item.fileType,
          });
          const purpose: "receipt" | "invoice" = "receipt";
          const [storageKey, parsed] = await Promise.all([
            withAuth((t) => uploadFile(t, file, purpose)),
            withAuth((t) => extractDocument(t, file)),
          ]);
          await updateRecord(item.id, {
            status: "ready",
            parsed,
            storageKey,
            attempts: item.attempts + 1,
            lastError: undefined,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const isTransient = isTransientError(msg);
          await updateRecord(item.id, {
            status: isTransient ? "pending" : "failed",
            attempts: item.attempts + 1,
            lastError: msg,
          });
        }
      }
    } finally {
      lockRef.current = false;
      setIsProcessing(false);
      await refresh();
    }
  }, [refresh]);

  // Initial load + on profile change
  useEffect(() => {
    refresh();
    // Hned zkus zpracovat to, co tam zbylo — typicky po reloadu page
    if (profileSyncId) processPending();
  }, [profileSyncId, refresh, processPending]);

  // Window online → retry
  useEffect(() => {
    const onOnline = () => processPending();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [processPending]);

  // Periodic retry while pending items exist (every 30s)
  useEffect(() => {
    const hasPending = items.some(
      (i) => i.status === "pending" || i.status === "processing",
    );
    if (!hasPending) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    if (intervalRef.current) return; // už máme interval
    intervalRef.current = setInterval(processPending, 30_000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [items, processPending]);

  const enqueue = useCallback(
    async (file: File, initialError?: string) => {
      if (!profileSyncId) throw new Error("No active profile");
      const id = await enqueueFile({ profileSyncId, file, initialError });
      await refresh();
      // Hned zkus, ať user nečeká dlouho
      processPending();
      return id;
    },
    [profileSyncId, refresh, processPending],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteRecord(id);
      await refresh();
    },
    [refresh],
  );

  const markSavedAndRemove = useCallback(
    async (id: string) => {
      // Po uložení dokladu user → smaž záznam ve frontě
      await deleteRecord(id);
      await refresh();
    },
    [refresh],
  );

  return {
    items,
    isProcessing,
    enqueue,
    remove,
    markSavedAndRemove,
    retryNow: processPending,
    refresh,
  };
}

/** Heuristika: je tato chyba "přechodná" (čeká na opravu) nebo trvalá? */
export function isTransientError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("500") ||
    m.includes("502") ||
    m.includes("503") ||
    m.includes("504") ||
    m.includes("timeout") ||
    m.includes("network") ||
    m.includes("síť") ||
    m.includes("fetch") ||
    m.includes("failed") ||
    // 401/403 — jen tranzientní pokud refresh tokenu projde; necháme jako transient
    // ať se přihlášený user nemusí starat
    m.includes("401") ||
    m.includes("403")
  );
}
