"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AutoSyncResult } from "@/lib/auto-sync";

/**
 * Toast zobrazený po dokončení sync. Auto-mizí po 8 vteřinách.
 *
 * Tvar (priority shora):
 *   1. Error: žlutý / červený, "Fio Hlavní: invalid token"
 *   2. Něco nového: zelený, "+3 tx z Fio | +2 faktury z iDoklad"
 *   3. Vše OK ale žádná novinka: šedý, "Vše aktuální"
 */
export function SyncStatusToast({
  result,
  onDismiss,
}: {
  result: AutoSyncResult | null;
  onDismiss: () => void;
}) {
  const t = useTranslations("auto_sync");

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [result, onDismiss]);

  if (!result) return null;

  const fioErrors = result.fio.perConnection.filter((c) => c.error);
  const hasFioError = fioErrors.length > 0;
  const hasIDokladError = result.idoklad.ran && !result.idoklad.succeeded;
  const anyError = hasFioError || hasIDokladError;

  let bg = "bg-ink-100 border-ink-300 text-ink-800";
  if (anyError) bg = "bg-amber-50 border-amber-200 text-amber-900";
  else if (result.anythingNew) bg = "bg-emerald-50 border-emerald-200 text-emerald-900";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-lg ${bg}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <div className="font-semibold">
            {anyError
              ? t("toast_with_errors")
              : result.anythingNew
                ? t("toast_new_data")
                : t("toast_all_up_to_date")}
          </div>

          {/* Fio summary */}
          {result.fio.perConnection.length > 0 && (
            <div className="text-xs space-y-0.5">
              {result.fio.perConnection.map((c, i) => (
                <div key={i} className={c.error ? "text-amber-800" : ""}>
                  {c.error ? (
                    <>⚠ Fio „{c.name}": {shortError(c.error)}</>
                  ) : c.added > 0 ? (
                    <>✓ Fio „{c.name}": {t("new_tx", { count: c.added })}</>
                  ) : (
                    <>✓ Fio „{c.name}": {t("no_new_tx")}</>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* iDoklad summary */}
          {result.idoklad.ran && (
            <div className="text-xs">
              {result.idoklad.error ? (
                <span className="text-amber-800">
                  ⚠ iDoklad: {shortError(result.idoklad.error)}
                </span>
              ) : result.idoklad.totalAdded > 0 ? (
                <>✓ iDoklad: {t("new_invoices", { count: result.idoklad.totalAdded })}</>
              ) : (
                <>✓ iDoklad: {t("no_new_invoices")}</>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("dismiss")}
          className="shrink-0 text-ink-500 hover:text-ink-900 text-lg leading-none -mt-1"
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** Zkrácení error message pro toast — schová HTTP detaily pokud jsou. */
function shortError(msg: string): string {
  // Trim very long messages, keep first sentence-ish
  const trimmed = msg.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 80) return trimmed;
  const cutoff = trimmed.indexOf(":", 30);
  if (cutoff > 0 && cutoff < 80) return trimmed.slice(0, cutoff);
  return trimmed.slice(0, 77) + "…";
}
