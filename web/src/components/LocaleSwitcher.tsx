"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/lib/locale-action";
import { auth } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-store";

/**
 * Vlajkový přepínač CS/EN. Po změně:
 *  1. Uloží locale do cookie (server action) — pro server-side rendering hned
 *  2. Pokud je user přihlášený, pošle PATCH /auth/me s novým locale
 *     (aby emaily přicházely ve správném jazyce)
 *  3. Obnoví stránku, aby se znovu načetly server-side strings
 */
const LOCALES: Array<{
  code: "cs" | "en";
  flag: string;
  label: string;
  ariaLabel: string;
}> = [
  { code: "cs", flag: "🇨🇿", label: "CS", ariaLabel: "Čeština" },
  { code: "en", flag: "🇬🇧", label: "EN", ariaLabel: "English" },
];

export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const current = useLocale();
  const [pending, startTransition] = useTransition();

  function change(next: "cs" | "en") {
    if (next === current) return;
    startTransition(async () => {
      await setLocaleAction(next);
      const token = getAccessToken();
      if (token) {
        try {
          await auth.updateMe(token, { locale: next });
        } catch { /* ignore */ }
      }
      window.location.reload();
    });
  }

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-full bg-ink-100/80 p-0.5 ${className}`}
      role="radiogroup"
      aria-label="Language switcher"
    >
      {LOCALES.map(({ code, flag, label, ariaLabel }) => {
        const active = current === code;
        return (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={ariaLabel}
            title={ariaLabel}
            onClick={() => change(code)}
            disabled={pending}
            className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium transition-all ${
              active
                ? "bg-white text-ink-900 shadow-sm"
                : "text-ink-500 hover:text-ink-700"
            } disabled:opacity-50`}
          >
            <span className="text-base leading-none" aria-hidden="true">{flag}</span>
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
