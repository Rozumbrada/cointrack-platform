"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/lib/locale-action";
import { auth } from "@/lib/api";
import { getAccessToken } from "@/lib/auth-store";

/**
 * Jednoduchý CS/EN přepínač. Po změně:
 *  1. Uloží locale do cookie (server action) — pro server-side rendering hned
 *  2. Pokud je user přihlášený, pošle PATCH /auth/me s novým locale
 *     (aby emaily přicházely ve správném jazyce)
 *  3. Obnoví stránku, aby se znovu načetly server-side strings
 */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const current = useLocale();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (next === current) return;
    startTransition(async () => {
      await setLocaleAction(next);
      const token = getAccessToken();
      if (token) {
        // Best-effort sync s backendem — pokud selže, cookie už je nastavená
        try {
          await auth.updateMe(token, { locale: next });
        } catch { /* ignore */ }
      }
      window.location.reload();
    });
  }

  return (
    <div className={`inline-flex rounded-lg border border-ink-300 bg-white overflow-hidden text-xs ${className}`}>
      {(["cs", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => change(l)}
          disabled={pending}
          className={`px-2.5 py-1 uppercase font-medium ${
            current === l ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50"
          } disabled:opacity-50`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
