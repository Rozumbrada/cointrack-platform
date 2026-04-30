"use client";

import { useTranslations } from "next-intl";
import { runAllSyncs, AutoSyncResult } from "@/lib/auto-sync";
import { markAutoSynced } from "@/lib/auto-sync-settings";

/**
 * Tlačítko pro manuální spuštění sync všech bank/iDoklad.
 *
 * - Click → callback `onStart` (caller ukáže spinner)
 * - Po dokončení → callback `onComplete(result)` (caller ukáže toast)
 *
 * Bypassuje auto-sync throttling (markne lastSync ale neříká si o povolení).
 */
export function SyncButton({
  profileSyncId,
  syncing,
  onStart,
  onComplete,
  variant = "sidebar",
}: {
  profileSyncId: string | null;
  syncing: boolean;
  onStart: () => void;
  onComplete: (result: AutoSyncResult) => void;
  variant?: "sidebar" | "topbar";
}) {
  const t = useTranslations("auto_sync");

  async function handleClick() {
    if (!profileSyncId || syncing) return;
    onStart();
    try {
      const result = await runAllSyncs(profileSyncId);
      markAutoSynced(profileSyncId);
      onComplete(result);
    } catch {
      // runAllSyncs nikdy nehází — ale pro jistotu fallback
      onComplete({
        fio: { succeeded: 0, failed: 0, totalAdded: 0, perConnection: [] },
        idoklad: { ran: false, succeeded: false, totalAdded: 0 },
        anythingNew: false,
      });
    }
  }

  if (variant === "topbar") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={!profileSyncId || syncing}
        title={t("manual_sync_title")}
        aria-label={t("manual_sync_title")}
        className="shrink-0 h-9 w-9 grid place-items-center rounded-lg text-ink-700 hover:bg-ink-100 disabled:opacity-40"
      >
        <span className={`text-base ${syncing ? "animate-spin" : ""}`} aria-hidden="true">
          🔄
        </span>
      </button>
    );
  }

  // sidebar variant — full width, with label
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!profileSyncId || syncing}
      className="w-full mt-2 flex items-center justify-center gap-2 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 disabled:opacity-50 px-3 py-2 text-xs font-medium text-ink-700"
    >
      <span className={syncing ? "animate-spin" : ""} aria-hidden="true">🔄</span>
      <span>{syncing ? t("syncing") : t("manual_sync_btn")}</span>
    </button>
  );
}
