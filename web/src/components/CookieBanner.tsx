"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

const STORAGE_KEY = "cointrack:cookie-consent";

type Consent = "essential" | "all";

export function CookieBanner() {
  const t = useTranslations("cookies");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
  }, []);

  function decide(consent: Consent) {
    localStorage.setItem(STORAGE_KEY, consent);
    setShow(false);
    // Notify rest of app — useful for analytics scripts that gate on consent
    window.dispatchEvent(new CustomEvent("cointrack:cookie-consent", { detail: consent }));
  }

  if (!show) return null;

  // text obsahuje placeholder {privacy_link} — rozdělíme na 3 části
  const text = t("banner_text", { privacy_link: "__LINK__" });
  const [before, after] = text.split("__LINK__");

  return (
    <div
      role="dialog"
      aria-label={t("banner_title")}
      className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4"
    >
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl border border-ink-200 p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="flex-1 text-sm text-ink-700 leading-relaxed">
          <div className="font-semibold text-ink-900 mb-1">{t("banner_title")}</div>
          <p>
            {before}
            <Link href="/privacy" className="text-brand-600 hover:text-brand-700 underline">
              {t("privacy_link_label")}
            </Link>
            {after}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => decide("essential")}
            className="h-9 px-4 rounded-lg border border-ink-300 bg-white hover:bg-ink-50 text-sm font-medium text-ink-900"
          >
            {t("essential_only")}
          </button>
          <button
            onClick={() => decide("all")}
            className="h-9 px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium"
          >
            {t("accept_all")}
          </button>
        </div>
      </div>
    </div>
  );
}
