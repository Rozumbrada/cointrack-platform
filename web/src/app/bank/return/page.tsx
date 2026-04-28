/**
 * Return page po Salt Edge Connect flow.
 *
 * Klient (web i Android) otvírá `POST /connect` → dostává URL Salt Edge widgetu.
 * Po dokončení flow Salt Edge redirectne na tuto stránku. Tady jen zobrazíme
 * informaci a zavřeme okno (pokud jsme popup) nebo pošleme na /app/banks.
 */

"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

export default function BankReturnPage() {
  const t = useTranslations("bank_return");
  useEffect(() => {
    // Pokud jsme v popup okně otevřeném z /app/banks, zavřeme se —
    // hlavní stránka se sama obnoví (lifecycle observer na mobilu,
    // manual refresh na webu).
    const isPopup =
      typeof window !== "undefined" && window.opener && window.opener !== window;
    if (isPopup) {
      try {
        window.opener.postMessage({ type: "cointrack:bank-connect-finished" }, "*");
      } catch {}
      setTimeout(() => window.close(), 1200);
    } else {
      // Android WebView zachytí tuto URL a sám zavře — jen pro jistotu
      // přesměrujeme na /app/banks jako fallback.
      setTimeout(() => {
        window.location.href = "/app/banks";
      }, 1500);
    }
  }, []);

  return (
    <div className="min-h-screen grid place-items-center bg-ink-50">
      <div className="max-w-md text-center bg-white rounded-2xl border border-ink-200 p-8 shadow-sm">
        <div className="text-5xl mb-4">✓</div>
        <h1 className="text-xl font-semibold text-ink-900 mb-2">
          {t("title")}
        </h1>
        <p className="text-sm text-ink-600">
          {t("subtitle")}
        </p>
      </div>
    </div>
  );
}
